# PktRutas por dentro

Cómo calcula el ruteo, de dónde saca la configuración del `.pkt`, qué revisa,
cómo está organizado el código y cómo se prueba. Para usar el programa basta
con el [README](../README.md).

## Cómo calcula el ruteo

La adyacencia se deduce de la capa 3: dos interfaces con IP en la misma subred
están en el mismo segmento. Los switches de capa 2 son transparentes, y los
multicapa sí entran como nodos.

Se resuelve **una red destino a la vez**: se mide a cuántos ruteadores de
distancia queda esa red desde cada equipo, y cada equipo reenvía al vecino que
lo acerca. Como el siguiente salto siempre queda más cerca del destino que uno
mismo, el ruteo no puede formar bucles ni con enlaces cruzados ni en mallas con
varios caminos del mismo costo. Los empates se rompen por la IP más baja, para
que dos ejecuciones den siempre el mismo resultado.

Calcular el camino más corto por separado desde cada origen —lo que parece lo
natural— no da esa garantía: dos equipos pueden elegir caminos opuestos hacia
la misma red y mandarse el tráfico el uno al otro.

Al terminar, el programa **sigue sus propias rutas** para cada par
origen-destino y lo reporta en la cabecera ("los N trayectos posibles llegan a
su destino sin bucles"). Si algo no cuadrara, lo dice antes de que pegues nada.

El ruteo es sólo IPv4: si la práctica tiene direcciones IPv6, el reporte las
muestra, pero no calcula rutas para ellas.

### Qué cuenta como "ya configurada"

No se comparan las rutas por igualdad exacta, sino **por cobertura**: una red
destino ya está resuelta si alguna ruta que el equipo tiene contiene esa red,
tomando siempre la más específica. Así una `ip route 0.0.0.0 0.0.0.0` o una
ruta sumarizada resuelven muchos destinos de golpe, y el reporte lo marca como
`(por 0.0.0.0/0)` en vez de pedir una ruta por cada red.

El reporte empieza por los comandos: la **sección 1** trae sólo lo que falta y
la **sección 2** todo lo de cada equipo, incluido el switch de núcleo, aunque
ya lo tenga puesto. Después vienen el plan de VLANs, el inventario, las
subredes, las comprobaciones y el detalle del cálculo.

Los equipos se nombran con su **hostname**: el que configuraste o, si aún
tenía el de fábrica, el que sale de su nombre en el lienzo. Si dos comparten
hostname se añade la etiqueta del lienzo entre paréntesis para distinguirlos.

### Prueba de alcance

Además del cálculo, el programa **camina la topología como lo haría un
paquete**, usando sólo las rutas que los equipos tienen puestas hoy: en cada
salto busca la coincidencia más larga, comprueba que el siguiente salto esté
en una red conectada del equipo y avanza al vecino, hasta llegar o quedarse
sin ruta. De ahí salen los avisos de "hacia X no llega el tráfico desde Y",
que es lo que explica un ping que sale pero no regresa.

## De dónde saca la configuración

Packet Tracer guarda varias cosas distintas dentro del `.pkt`, y el programa
las usa todas:

* El **árbol de módulos** (`ENGINE/MODULE/SLOT/...`) da los puertos físicos.
  Ahí no hay nombres: cada `<PORT>` sólo trae su tipo, y el nombre se
  reconstruye por la posición (routers desde 0, switches desde 1, equipos
  finales sin diagonal). Los `<CABLE>` sí traen el nombre real y sirven para
  verificarlo; si no coinciden, el reporte lo avisa.
* El **running-config** (`RUNNINGCONFIG/LINE`) trae la configuración tal cual
  la escribiste. De ahí salen las **subinterfaces** de VLAN con su
  `encapsulation dot1Q`, las SVI, las rutas estáticas ya puestas, los pools de
  DHCP y el hostname. Manda sobre el árbol de módulos.
* Las **notas** del lienzo (`PHYSICALWORKSPACE/NOTES/NOTE`), con su posición:
  de ahí salen el plan de VLANs y la red de cada enlace. El nombre de cada
  equipo en el lienzo (`ENGINE/NAME`) da los hostnames que falten.

Por eso el reporte distingue las rutas que ya tienes de las que faltan, y
puede revisar que cada pool de DHCP entregue la puerta de enlace correcta.

Al leer, el orden importa: primero las notas, luego los hostnames que salen
del lienzo, luego los enlaces (que se configuran o corrigen) y al final el plan
de VLANs, que así ya ve los enlaces y se acomoda alrededor.

## El .pkt configurado

Packet Tracer guarda la configuración de cada equipo como el texto de su
running-config y lo vuelve a aplicar al abrir el archivo; aparte guarda el
hostname (`ENGINE/SYS_NAME`), el estado de cada puerto (`PORT/POWER`, `IP`,
`SUBNET`) y las VLANs de los switches (`ENGINE/VLANS` y tres copias de
`vlan.dat`). El programa deja todo eso como quedaría después de pegar los
comandos y hacer `write memory`, con el mismo formato que usa Packet Tracer.

El XML se edita por rangos de bytes (con `expat`) en vez de volver a
serializarlo, porque ElementTree reescribe `<X></X>` como `<X />`: así el resto
del archivo queda byte por byte igual. Antes de guardar se vuelve a leer la
copia y se comprueba que ya no le falte nada.

## Switches multicapa (capa 3)

Un switch de núcleo cuenta como equipo que enruta: sus SVI y sus puertos
ruteados son redes conectadas, entra en el grafo y recibe sus propias rutas.
Packet Tracer suele guardar el 3560 con `TYPE` = `Switch`, así que se reconoce
por modelo (3560, 3650, 3750, 3850, 4500, 6500, 6800, 9200–9500) o por
comportamiento: un switch con IP en dos o más subredes se toma como capa 3. Un
2960 con una sola SVI de administración sigue siendo capa 2.

Como sin `ip routing` las SVI no se comunican entre sí, el comando se incluye
en el bloque del switch aunque no necesite ninguna ruta estática.

## Qué revisa del `.pkt`

IP duplicadas, máscaras inválidas, direcciones de red o de broadcast asignadas
a una interfaz, interfaces con IP pero apagadas, cables que unen subredes
distintas, puertas de enlace fuera de rango o inexistentes, subredes sin
ruteador, ruteadores sin camino hacia el resto de la red, switches multicapa
sin `ip routing`, enlaces punto a punto con un solo extremo configurado,
hostnames repetidos o de fábrica, nombres del lienzo que no sirven como
hostname, pools de DHCP cuya red o puerta de enlace no cuadra con la interfaz
del equipo, rutas que apuntan a un siguiente salto fuera de las redes
conectadas, redes a las que el tráfico no puede regresar, IPs de VLAN puestas
en `interface VlanN` de un router (en vez de en la subinterfaz), subinterfaces
sin IP, VLANs del plan que se enciman entre sí o con los enlaces, notas de
enlace que no son una dirección o que no coinciden con su enlace, y PCs sin
VLAN o con una VLAN que su sitio no tiene.

## Sobre el formato .pkt

Packet Tracer guarda un XML comprimido y cifrado. Han existido dos formatos:

* Hasta PT 8.1: XOR con un contador que decrece desde la longitud del archivo,
  y encima `qCompress` de Qt (4 bytes de tamaño + zlib).
* PT 8.2 en adelante (incluida la 9.x): además una inversión con máscara
  posicional y cifrado **Twofish en modo EAX** con clave e IV fijos.

El programa prueba los formatos conocidos en orden y se queda con el primero
que produzca XML válido, así que no hay que decirle con qué versión se guardó.
Para escribir hace el camino inverso del formato moderno: al volver a cifrar un
archivo sin cambios sale idéntico, byte por byte, al que guardó Packet Tracer.

Twofish está implementado desde cero y se comprueba contra los vectores
oficiales `ecb_ival` de las tres longitudes de clave.

## El instalador

`Instalar.bat` busca el lanzador `py` de python.org (viene firmado, y el
Control inteligente de aplicaciones de Windows 11 bloquea los Python sin
firma), revisa que haya Python 3.10 o más nuevo con tkinter y corre
`instalar.py`, que:

* copia el programa, el ícono y la ayuda a `%LOCALAPPDATA%\Programs\PktRutas`
  (sin las pruebas); si ya había una versión, la reemplaza completa;
* crea los accesos directos del menú Inicio, el escritorio y **Enviar a**. Las
  carpetas las pide a Windows (`SHGetKnownFolderPath`), porque el escritorio
  puede estar en OneDrive, y los `.lnk` los escribe con `IShellLinkW` por
  `ctypes`. Apuntan a `pyw -3 app.py` (o a `pythonw`), que abre la ventana sin
  consola y sigue sirviendo cuando actualizas Python;
* lo registra en `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall`,
  para que aparezca en Configuración → Aplicaciones con su botón de
  Desinstalar, que corre `instalar.py --desinstalar`.

Todo es por usuario: no pide permisos de administrador. Nunca borra una carpeta
que no tenga `app.py` y `pkt/modelo.py`, y al desinstalar sólo quita los
accesos directos que abren esa instalación.

No es un `.exe` a propósito: uno sin firma digital lo bloquea el Control
inteligente de aplicaciones y SmartScreen lo marca como peligroso, y firmarlo
requiere un certificado de pago.

## Desde la consola

```bash
python analizar.py practica.pkt                     # reporte en practica_ruteo.txt
python analizar.py practica.pkt -o salida.txt       # con otro nombre
python analizar.py practica.pkt --pkt copia.pkt     # además, el .pkt configurado
python analizar.py practica.pkt --xml               # guarda también el XML interno
```

## Estructura

```
app.py                 la ventana (punto de entrada)
analizar.py            la versión de línea de comandos, sin ventana
Analizar.bat           abre la ventana sin instalar; acepta un .pkt arrastrado
Instalar.bat           instalador por usuario (llama a instalar.py)
instalar.py            instala, actualiza y desinstala
pktrutas.ico           ícono de la ventana y de los accesos directos
LEEME.txt              primeros pasos para quien recibe el programa
GUIA.html              guía de uso con capturas (Ayuda → Guía de uso)
docs/                  este documento y las capturas del README

ui/tema.py             paleta, widgets y navegación por teclado
ui/menu.py             barra de menú al estilo del Bloc de notas
ui/nucleo.py           estado compartido y clase base de las vistas
ui/panel_archivo.py    F1, el archivo .pkt
ui/panel_salida.py     F2, la salida

pkt/twofish.py         cifrador Twofish en Python puro
pkt/descifrar.py       formatos .pkt: ofuscación, Twofish-EAX, zlib
pkt/modelo.py          lectura del XML -> equipos, interfaces, cables, notas
pkt/configuracion.py   lectura del running-config guardado en el .pkt
pkt/nombres.py         hostnames a partir del nombre en el lienzo
pkt/enlaces.py         los enlaces entre routers: de sus notas, o corregidos
pkt/plan.py            plan de VLANs de las notas y la configuración de LAN
pkt/vlsm.py            el prefijo que necesita una VLAN según sus equipos
pkt/red.py             subredes, ruteo estático y comprobaciones del .pkt
pkt/reporte.py         reporte de texto y bloques de comandos por equipo
pkt/escribir.py        la copia del .pkt con todo ya aplicado
```

No usa nada fuera de la biblioteca estándar de Python. Si está instalado
`tkinterdnd2`, además se puede soltar un `.pkt` sobre la ventana.

## Pruebas

```bash
python prueba_cripto.py      # Twofish y el descifrado del .pkt
python prueba_topologia.py   # análisis completo de una red de ejemplo
python prueba_interfaz.py    # arma la ventana y ejecuta las dos vistas
python prueba_plan.py        # notas de VLAN, EtherChannel, STP y router-on-a-stick
python prueba_enlaces.py     # corrección de enlaces mal tecleados
python prueba_completa.py    # práctica en blanco: todo sale de las notas
python prueba_escribir.py    # el .pkt configurado: running-config, VLANs y releerlo
python prueba_instalador.py  # instala en una carpeta temporal y desinstala
```

`prueba_instalador.py` no toca tu menú Inicio ni tu escritorio: instala en una
carpeta temporal y usa una clave de prueba del registro, que borra al
terminar.
