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
tomando siempre la más específica, y el tráfico llega por ella (ver "Los
equipos que se rehacen desde cero"). Así una `ip route 0.0.0.0 0.0.0.0` o una
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

## El formato de los comandos

Por dentro, cada orden se guarda con la forma completa de IOS (`interface
FastEthernet0/0`, ` ip address ...`), que es también la que Packet Tracer
guarda en el running-config: así se compara con lo que ya tiene cada equipo y
se escribe el `.pkt` configurado. Sólo al mostrarlos (`pkt/formato.py`) se
pasan al estilo de las prácticas:

* en mayúsculas y abreviados: `EN`, `CONF T`, `INT FA0/0`, `INT ETH0/1/0`,
  `INT GI0/1`, `INT VLAN 3`, `IP ADD`, `NO SHUT`; lo demás va completo
  (`SWITCHPORT MODE TRUNK`, `ENCAPSULATION DOT1Q 3`);
* los nombres tuyos, tal cual (`HOSTNAME sw10`, `NAME ventas`): en mayúsculas
  renombrarían el equipo, y al volver a leer la práctica ya no coincidirían;
* sin comentarios ni `END` / `WRITE MEMORY`, y cada bloque empieza con su
  `HOSTNAME`, que es lo que dice de qué equipo es;
* lo de alcance global junto, cada interfaz, VLAN o pool en su párrafo, y `===`
  entre un equipo y otro. Los enlaces de cada equipo van en el orden en que
  IOS lista los puertos (Fa0/0, Fa0/1, Eth0/1/0...).

IOS no distingue mayúsculas en los comandos y acepta esas abreviaturas; al
pegarlos, el running-config queda en su forma completa, la misma que el
programa espera al volver a leer la práctica.

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

## Los equipos que se rehacen desde cero

`pkt/rehacer.py` busca, equipo por equipo, errores que no se quitan agregando
comandos. Cada orden del programa sólo agrega o reemplaza, y esos errores
piden un `no`:

* **Rutas.** Para cada red se sigue el camino del tráfico como quedaría
  después de aplicar lo que falta, con la ruta más específica de cada equipo
  y resolviendo los saltos que no son de un vecino como lo hace IOS (rutas
  recursivas). Una ruta tuya está mal si por ella el tráfico no llega (da
  vueltas o se pierde) **y** su salto ni siquiera acerca al destino: si acerca,
  el culpable es un equipo de más adelante. Así una ruta que da la vuelta
  larga en un anillo se respeta. Si la mala es una ruta más amplia (una por
  omisión), basta con agregar la específica, que le gana; si es justo a esa
  red, hay que quitarla.
* **Pools** que cubren la red de una VLAN y no coinciden en red, máscara y
  puerta de enlace con ninguna VLAN del equipo.
* **EtherChannel** que no se forma: se ven los modos de las dos puntas (los
  que tienen, o los que les va a poner el plan) y se forma con `on`/`on`,
  LACP (`active` con `active` o `passive`) o PAgP (`desirable` con
  `desirable` o `auto`). También puertos del mismo canal en grupos o modos
  distintos, o canales en puertos que no van en EtherChannel.
* **STP**: una prioridad de 4096 o menos en la VLAN 1, fuera de la raíz de su red.
* **Router-on-a-stick**: una IP en el puerto de las subinterfaces que no
  comparte nadie (si alguien más está en su red, es la VLAN nativa a
  propósito), una SVI con IP o una subinterfaz con la VLAN cambiada.

A esos equipos `quitar()` les saca del running-config las rutas, los pools y
sus `excluded-address`, las prioridades de STP, las subinterfaces, las SVI
(menos la VLAN 1), los Port-channel, los `channel-group`, las IPs de los
puertos y los `no switchport`, y da los `no ...` que hacen lo mismo en la CLI.
Después va su configuración completa: el hostname, todos sus puertos con IP
(también los que ya estaban bien), lo del plan y todas sus rutas. Lo demás del
running-config no se toca. El `.pkt` configurado usa el running-config limpio
como base, y al volver a leerlo se comprueba que ya no quede nada que rehacer.

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

## El módulo de Packet Tracer

`modulo/` es la misma lógica en JavaScript, porque un Script Module no corre
Python. Tiene su propio juego de notas: además de lo de `pkt/`, revisa los combos,
genera IPv6 y aplica en vivo.

**Por qué lee el archivo entero.** La API tiene `getCanvasNoteIds` y
`getCanvasNoteText`, pero una nota pegada con Ctrl+V conserva el uuid de la
original y la API sólo alcanza a la primera: con dos notas iguales, el texto de la
segunda no se puede leer. `fileSaveToBytes` sí da todo, al momento y sin guardar,
así que el módulo descifra esos bytes (Twofish-EAX, como `pkt/descifrar.py`) y lee
el mismo XML. Tarda unos 250 ms y las pruebas leen los `.pkt` igual que Packet
Tracer. Para corregir una nota con el uuid repetido, el pánico quita las notas que
lo comparten y las vuelve a poner, ya con uuid propio y en su mismo lugar.

**En qué orden salen las redes.** Varios sitios comparten la base, así que el orden
decide cada número. A mano se hace una tabla por VLAN y se tachan los bloques que
chocan con lo ya repartido, por eso una red de otra VLAN recorre todas las siguientes.
No hay una sola regla: en `P4_P3` van de la más chica a la más grande y por número de
router, con el multicapa en el lugar del router del que cuelga; `P3_P2`, resuelta a mano,
va de la más grande a la más chica, routers primero; lo que guardó el programa antes va
sitio por sitio. `_REPARTOS` lista esos órdenes y `_elegirReparto` (`_elegir_reparto` en
Python) los calcula todos y se queda con el que más coincide con los combos y con lo ya
configurado. Sin nada escrito gana el primero, el de `P4_P3`. Con usuarios en vez de
diagonales, gana el VLSM clásico. El reparto no pisa nada porque cada bloque se compara
contra lo ocupado; lo que puede encimarse son los combos escritos, y `_revisarEncimadas4`
dice con qué. Python no revisa combos: los toma como la red de esa VLAN, tal cual.

**Combos desplazados.** Una red escrita es correcta si cuadra con su diagonal, no se encima y
no se aleja más de un bloque, de su propio tamaño, de lo que le toca por la cuenta (lo pidió el
usuario el 5-nov-2026). `_respetarEscritas` deja esas donde las escribieron y reparte lo demás
alrededor. Las que no cuadran se corrigen ahí donde iban contando; las que se fueron lejos, desde
lo que les tocaba. Las dos, antes de repartir las que no traen dirección. Una que va fuera de
orden, como una olvidada, puede medirse además contra `_trasLaAnterior`, el primer bloque después
de la red que tiene abajo: ahí empieza a contar quien olvidó un combo. La cuenta decide también
quién gana si dos escritas se enciman, que es la que coincide.
Para esa elección, quien olvida un combo y lo agrega contando desde el último no debe recorrer
a nadie: por su orden iría antes y las de después dejarían de coincidir. `_fueraDeOrden` lo
detecta con la secuencia creciente más larga: de la más chica a la más grande cada red queda
arriba de las anteriores (el primer bloque libre de un tamaño nunca queda abajo de uno más chico
ya puesto), y por eso sólo se intenta en ese orden. Lo que no entra en la secuencia se aparta
si así coinciden más combos. Lo apartado no suma en `puntos`: si no, cualquier orden ganaría
declarando todo 'fuera de orden'. Las VLANs con diagonal y sin combo se apartan juntas y van
después de la última red, sólo si eso hace coincidir más combos. En Python un combo escrito ya
se toma tal cual; lo único distinto es esa VLAN sin combo, que ahí toma el primer bloque libre.

**Lo que aprendimos de Packet Tracer 9.0.1:**

* El motor es QJSEngine: `let`, flechas, clases, `Map`, `Set` y arreglos tipados,
  pero no BigInt, por eso IPv6 son 8 grupos de 16 bits.
* Los scripts se cargan en orden alfabético, no en el de la lista: ningún archivo
  puede depender de otro al cargarse.
* `$se` tarda unos milisegundos en existir después de cargar la página, y `setHtml`
  no lo trae: la barra tiene que ser una interfaz `this-sm:`.
* `$se` pierde en silencio la llamada entera si un argumento trae un salto de línea o
  un retorno, sin error en ningún lado. Comillas, diagonales y acentos sí pasan. Por
  eso la página sólo manda órdenes y números: el texto de los comandos no sale del módulo.
* A cada vista le agrega una hoja de estilos que pinta `html` y `body` con
  `!important`, a partir de `--pt-bg-color` y `--pt-text-color`, siempre blanco y
  negro. Todo lo que herede de `body` sale negro: los colores se le dan redefiniendo
  esas variables, también con `!important`.
* Las vistas llevan zoom según la escala de la pantalla (`getZoomFactor`: 1.3 al
  125 %), pero `createWebView` y `setGeometry` reciben píxeles reales. La barra pide su
  tamaño en píxeles de la página y el módulo lo multiplica por el zoom. El `screenX` del
  ratón sí va en píxeles reales, los mismos de `setGeometry`.
* Una vista suelta no tiene dueño en Windows: al hacer clic en Packet Tracer se le queda
  detrás, y con `WindowStaysOnTopHint` se quedaría encima de todas las aplicaciones.
  `attachToMainViewArea` la mete en el área del lienzo, sin ventana ni barra de título; hay
  que llamar a `show` después o no se dibuja. Ahí `setGeometry` usa coordenadas del lienzo y
  la vista se encima sin mover nada, así que puede crecer mientras haya un menú abierto.
  `dockToMainViewArea` en cambio le quita al lienzo una columna o una fila entera, y le
  pone su propio título.
* Adjuntar la primera vista hace que Packet Tracer vuelva a crear su ventana principal:
  cambia de HWND, sigue maximizada y en su lugar. Es un parpadeo, una vez por sesión.
* Al abrir un archivo o con File > New, el lienzo nuevo queda encima de la vista adjunta:
  hay que volver a llamar a `raise`. Logical/Physical y Realtime/Simulation no la tapan.
* Un clic en el lienzo le quita el foco a la vista, y la página recibe `blur`: con eso se
  cierran sus menús.
* Justo al abrir una práctica guardada sin configurar, el archivo aún no trae la
  running-config de sus equipos; a los pocos segundos ya traen la de fábrica. Para que los
  comandos salgan iguales desde la primera lectura, un router o switch sin configuración
  se trata como uno de fábrica.
* Cada apertura crea objetos nuevos: `getActiveFile().getObjectUuid()` cambia aunque se
  reabra el mismo archivo, cuando `getSavedFilename` sigue igual. La barra mira ese
  uuid cada medio segundo mientras está abierta. No usa el aviso `fileOpened`: en una
  prueba el módulo pareció releer sin que se abriera nada, y aunque no se pudo
  reproducir, así no depende de él. `fileSaveToBytes` no dispara ningún aviso.
* `changeNoteText` guarda el texto, pero la nota deja de dibujarse hasta reabrir el
  archivo. El pánico quita la nota y la vuelve a poner en su lugar, con `addNote` y
  `setCanvasItemRealPos`, y así se sigue viendo.
* Los temporizadores siguen vivos al abrir otro archivo, y `getDevice` busca por nombre:
  un reintento pendiente tocaría a los equipos de la otra práctica que se llamen igual.
  Por eso cada uno guarda el uuid con el que empezó y se detiene si ya cambió.
* `enterCommand` es síncrono. Un error se ve en la salida (`outputWritten`), en una
  línea que empieza con `% `; los avisos de log no llevan el espacio.
* Un equipo recién puesto en el lienzo arranca en el diálogo inicial
  (`Would you like to enter...`) y uno ya configurado en modo `logout`.
* Un 3560 rechaza `ipv6 unicast-routing` hasta que `sdm prefer
  dual-ipv4-and-ipv6 default` y un reinicio lo activan. Un 3650 no necesita nada.
  El módulo lo detecta por el rechazo, guarda, reinicia y termina al volver.
* Un 2960 no acepta IPv6. Un multicapa sin IP, sin `ip routing` y sin nota que lo
  nombre se trata como switch de capa 2.
* El `.pts` va cifrado y sólo Packet Tracer lo escribe, con el botón Export de su
  editor. Sin firma también lo acepta, y sólo lo busca en donde se agregó con Add.
* El editor no acepta el ID de un módulo ya agregado: lo avisa al cambiar de pestaña.
  Por eso `armar_pts.ps1` lo quita primero, sólo en su sesión; se cierra a la fuerza
  y el módulo sigue agregado en los demás Packet Tracer.

**Para volver a armar el `.pts`** después de cambiar algo:

```powershell
modulo\pruebas\armar_pts.ps1
```

Abre un Packet Tracer aparte en un escritorio oculto de Windows (`pruebas/oculto.ps1`),
llena el editor con UI Automation y lo cierra: no se ve, no quita el foco y no toca los
que ya estén abiertos. Con `-Visible` se abre en pantalla, para ver qué falla. Luego
hay que quitar y volver a agregar el módulo, o reiniciar Packet Tracer si es el mismo
archivo.

En ese escritorio Packet Tracer corre completo y `PrintWindow` lo captura, con diálogos
de archivos y todo. Tres cosas no se aíslan: el portapapeles es de toda la sesión, el
Bloc de notas y el navegador pueden abrirse en la pantalla de verdad, y el puntero sólo
se puede simular con el botón abajo: Qt descarta los movimientos sin botón, y con él sí
llegan, lo que basta para probar un arrastre. Una prueba que corra ahí no debe copiar ni
abrir archivos o enlaces; lo del puntero lo cubre `prueba_ventana.js`.

**Prácticas a medias.** Las notas mandan, y lo que falta no es lo mismo que lo que está mal.
Cada orden del plan se marca `presente` (ya está) y `mal` (lo que el puerto trae la contradice);
`motivosRehacer` junta las `mal` con lo que se ve de conjunto: rutas, pools, canales, STP, enlaces
fuera de su nota (`correcciones.mal`) e interfaces encima de lo planeado. Un equipo con motivos se
borra entero; los demás sólo reciben sus órdenes no presentes.

`analizarXml` lee por vueltas: `_analizar(xml, quitar)` deja a los equipos de `quitar` en el modelo
como quedarán al borrarlos (`_limpiarEquipo`), así lo que tenían ya no aparta redes, no se rutea y
no le da pistas a nadie, y eso puede dejar a la vista lo que otro tiene mal. Termina cuando nadie
nuevo se suma. Del equipo borrado se recuerda `redesDeAntes`, porque de ahí sale de quién es una nota
sin nombre, y la IP de sus puertos con cable: un enlace sin nota sigue siendo del usuario.

Lo que aparta una red para la cuenta es sólo lo que no contradice a las notas: un enlace
(`_esEnlaceConfigurado`) sí; cualquier otra cosa encima de un combo, no, y ese equipo se borra. Una
interfaz que es justo lo que dicen las notas no se marca aunque otra nota se le encime (`P9_5T` trae
una VLAN y un enlace encimados): eso no se arregla borrando. Una PC se reparte si su puerto está en
una VLAN que ninguna nota dice; si otra nota la dice, se respeta: `P4_P3` tiene la V6 en R1 y R7,
que llega a SWR1 por otro cable, con lo inalámbrico.

**Los modos de Aplicar.** `analizarXml(xml, { modo })` recibe `activo`, `estricto`, `medio` o `bajo`
(`MODOS`, en `comandos.js`; cualquier otro es activo). En uno pasivo, `_pasivo` mide en la primera
vuelta, sin nadie borrado, qué router o core cumple: `_empezado` (alguna IP, pool o ruta en su
running-config; el hostname no cuenta), `_faltasEnlaces` (nada en `correcciones.mal` y ninguna orden
de `correcciones.ordenes` con `ip address`: lo que aplicar pondría en sus /30; un `no shutdown` solo no
cuenta) y `_faltasDhcp` (un pool idéntico en red, máscara y puerta por cada VLAN de su sitio, también las
de combo mal; sin `no service dhcp` ni `excluded-address` que deje sin direcciones a sus PCs). Los
switches de `s.switches` siguen a su dueño. Con eso, `puede(n)` filtra todo: sólo lo que cumple entra a
`quitar`, a la regla de "más de la mitad" y a `Borrar todo`; los bloques, los completos, las PCs del DHCP
y lo inalámbrico (`_inalambricoQueCumple`, por el `sitio` de la controladora, el server y los AP, y el
`dueno` de los teléfonos) se quedan sólo con lo suyo. Los `motivos` de lo que no cumple no se
reportan: no se rehace. El que cumple se trata igual que en activo, y si trae otra cosa mal se borra
entero y vuelve con su DHCP y sus /30 tal cual (el pool puede cambiar de nombre).

`_aplicarTodo` guarda quién cumplía al empezar y lo pasa a cada relectura (`{ cumplian }`): a media
aplicación un equipo puede no traer ya lo que el modo pide. Lo encontró la escena en Packet Tracer: en
bajo, SWR2 (un 3560 con su /30 malo) se borró, se reinició para IPv6 con sólo lo borrado guardado, y al
volver ya no contaba como empezado; sin `cumplian` se quedaba así, sin configurar.

`ctx.pasivo` guarda `cumplen`, `noCumplen` y `faltas` (`[equipo, qué]`); `textoProblemas` las pone
arriba de todo y `hayProblemas` las cuenta. `principal.js` guarda el modo en `pktrutas_modo.txt`, en
`getUserFolder()` (si no, en la carpeta temporal), lo lee en `main()`, lo manda a la página con
`modo(...)` y en `mostrar`, y `uiModo` lo cambia y vuelve a leer sin abrir el Bloc de notas.

Trampas de Packet Tracer 9.0.1, medidas en un equipo real:

* `no interface Port-channelN` deja sus puertos con `shutdown`, salvo que antes se les quite
  `channel-group`. Por eso las interfaces creadas se borran al último.
* El `Port-channel` a veces no muestra `switchport mode trunk` aunque el canal esté bien: se depende
  de lo que digan sus puertos.
* `no switchport mode` no hace nada con `switchport nonegotiate` puesto: va al último del puerto.
* `Device.restoreToDefault(a, b)` devuelve `true` y no cambia la configuración.
* `default interface` existe, pero no quita `shutdown` y deja `switchport mode trunk`.
* Las PCs no tienen `getDefaultGateway`: la puerta que les dio el DHCP sale en `<GATEWAY>`.
* Un 3560 no deja poner una troncal sin `switchport trunk encapsulation dot1q`, aunque sólo haga de
  switch, y lo dice con `Command rejected`, sin `%`. Un 3650 rechaza esa misma línea con `%`.

**Lo inalámbrico.** La controladora no tiene API ni consola: `getCommandLine()` existe, pero no
responde. Su configuración es texto en el `.pkt`: `MANAGEMENT_INTERFACE`, `WLC_INTERFACES` y
`CAPWAP_AC` (`WLANS`, `AP_GROUPS`, `APS`, `RADIUS_SERVERS`, `LOCAL_USERS`), con claves sin cifrar.
`IN_SETUP_MODE` en `false` hace que el portal ya no pida el asistente. Por eso `principal.js` hace
`fileSaveToBytes`, parcha el XML (`parchearInalambrico`), lo cifra (`cifrarPkt`, sin comprimir) y
`fileOpenFromBytes(bytes, ruta)`. Abrir así no pide confirmación, tarda alrededor de un segundo,
conserva el nombre del archivo y cambia el `uuid` de la práctica, así que `_LEIDO` se actualiza para
que el vigía no la tome por otra. Se aprovecha para escribir igual el `ACS_SERVER` del server, el
`CAPWAP` de los AP y el `WIRELESS_CLIENT` de los teléfonos. Con el AP en `P3_P3`, desde que se abre:
el AP tiene IP a los 33 s y los teléfonos a los 54 s.

Comparar sin reabrir: `leerInalambrico` lee lo que cada equipo tiene y `_firmaWlc` y `_firmaServidor`
lo comparan con el plan. Una interfaz dinámica nueva necesita MAC propia: `_macDe` la deriva de su
nombre. En las PCs y en cada troncal, la nativa sale de `s.nativa`, que en el sitio del multicapa
es la del router del segundo cable (`s.routerNativa`). `_reservarTroncales` evita que ese cable reciba
un /30 como cualquier enlace sin nota.

El server en el core: `_apartarServidor`, antes de repartir las PCs, saca de `s.pcs` al server de un
sitio con controladora y lo deja en `s.servidor`; si no, le tocaría VLAN y DHCP como a una PC.
`_puertaDelServidor` decide dónde va su puerta: en un multicapa, su mismo puerto (`no switchport`); en un
sitio con router, `s.vlanServidor`, que `_vlansDelSitio` agrega a las demás (por eso llega a la base de
VLANs y a la revisión de troncales, y no cuenta como sobrante), con subinterfaz en el router; sin
`s.servidor`, el puerto del router, como antes. Un server en un switch de abajo de un multicapa no entra:
ahí no se puede poner `no switchport`, y se avisa. `_planServidor` sólo respeta la IP del puerto si es de
`192.168.x` (cualquier otra se cambia), y si esa puerta es la `.1`, el server toma la `.2`. Al mover el cable hay dos sobras: `srv.viejos`, el
puerto sin cable con IP en esa red, y `srv.rutasDeSobra`, la ruta que la puerta traía hacia la red que
ahora tiene conectada. `aplicarAlModelo` las quita también del modelo: si no, `construirSubredes` ve dos
dueños de la misma red y al router que se quedó sin el server no le calcula su ruta. Sin el server, el
router de la nativa se queda sin LAN para `_conLan`, pero `_bajarAlMulticapa` no le quita su nota mientras
el multicapa tenga la suya.

Un 3650 de capa 2 y un WLC o AP cuentan en `_grafoL2` como vecinos sin IP. Un `Port` de un teléfono es
`Wireless0`. `Device.getType()`: controladora 41, LAP 44, teléfono 20, server 9, multicapa 16.

Un AP recién puesto en el lienzo trae su puerto de cable en `UP_METHOD 0` y sin DHCP: no pide IP y no llega a
la controladora, sin ningún aviso. `_parchearAp` lo deja en `1` con DHCP; los de `P3_P3` y `P4_P3` ya venían
así porque se hizo a mano en su pestaña Config, y sólo se notó con los de `O5_P3`.

Un AP con el puerto del radio (`eAccessPointWirelessN`) en `UP_METHOD 5` y DHCP encendido anuncia su red,
pero nadie se le puede asociar y el teléfono no reintenta. `P4_P3` traía uno así: fallaba o no según a
qué AP se fuera cada teléfono, y parecía intermitente. `_parchearAp` lo deja en `0` y sin DHCP. Para ver
por qué un teléfono no conecta: `WirelessClientProcess.getCurrentNetworkAt(i)` dice qué ve en el aire y
`getCurrentApMac()` a quién se asoció. Los AP tienen su BSSID en la MAC del radio, no en la de su puerto.

**Archivos:**

```
modulo/bytes.js        de los bytes del .pkt al XML y de regreso: Twofish-EAX, inflate, UTF-8
modulo/ipv.js          direcciones IPv4 e IPv6, y orden como las tuplas de Python
modulo/modelo.js       XML -> equipos, cables, notas y running-config
modulo/plan.js         notas, de quién es cada una, reparto de redes y órdenes
modulo/enlaces.js      los enlaces: /30 de su nota o corregidos, y su /127
modulo/rutas.js        ruteo estático en IPv4 e IPv6
modulo/combos.js       tus combos contra el programa, y qué corrige el pánico
modulo/inalambrico.js  controladora, AP, server RADIUS y teléfonos: qué les toca y cómo se escribe
modulo/comandos.js     estilo de los comandos, equipos que se rehacen, lo pendiente
modulo/principal.js    lo único que habla con Packet Tracer: barra, Bloc de notas y aplicar
modulo/ventana.htm     la barra del módulo
modulo/PktRutas.pts    todo lo anterior, ya armado
```

**Pruebas:**

```bash
node modulo/pruebas/prueba_nucleo.js    # combos, pánico, IPv6 y qué abre, copia y dice el módulo
node modulo/pruebas/prueba_ventana.js   # la barra, con ratón y teclado de verdad
```

`prueba_ventana.js` corre la página real en Edge o Chrome sin ventana y simula lo que
Packet Tracer le hace: su hoja de estilos y el `$se` que llega tarde y pierde los saltos
de línea. No abre nada en pantalla ni toca el portapapeles. `prueba_nucleo.js` corre
`principal.js` en Node con un Packet Tracer de mentira: anota lo que abriría en el Bloc de
notas y lo que copiaría, sin hacerlo.

`modulo/comparar.js` compara los comandos con los de la versión en Python, práctica
por práctica; en 51 de las 57 de la prueba salen idénticos, y en las otras 6 la
diferencia es lo nuevo (combos, IPv6, el multicapa de capa 2 y el reparto de PCs).
`modulo/pruebas/PruebaPT.js` corre pasos dentro de Packet Tracer sin clics.

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

ui/tema.py             colores y letras; claro u oscuro, como Windows
ui/menu.py             barra de menú al estilo del Bloc de notas
ui/barras.py           barras de desplazamiento delgadas, como las de Windows 11

pkt/twofish.py         cifrador Twofish en Python puro
pkt/descifrar.py       formatos .pkt: ofuscación, Twofish-EAX, zlib
pkt/modelo.py          lectura del XML -> equipos, interfaces, cables, notas
pkt/configuracion.py   lectura del running-config guardado en el .pkt
pkt/nombres.py         hostnames a partir del nombre en el lienzo
pkt/enlaces.py         los enlaces entre routers: de sus notas, o corregidos
pkt/rehacer.py         qué equipos se rehacen desde cero y qué se les borra
pkt/plan.py            plan de VLANs de las notas y la configuración de LAN
pkt/vlsm.py            el prefijo que necesita una VLAN según sus equipos
pkt/red.py             subredes, ruteo estático y comprobaciones del .pkt
pkt/reporte.py         los comandos de cada equipo y el reporte de texto
pkt/formato.py         el estilo de los comandos: EN, CONF T, INT FA0/0, ===
pkt/escribir.py        la copia del .pkt con todo ya aplicado
```

No usa nada fuera de la biblioteca estándar de Python. Si está instalado
`tkinterdnd2`, además se puede soltar un `.pkt` sobre la ventana.

## Pruebas

```bash
python prueba_cripto.py      # Twofish y el descifrado del .pkt
python prueba_topologia.py   # análisis completo de una red de ejemplo
python prueba_interfaz.py    # la ventana: abrir, copiar equipo por equipo, guardar
python prueba_formato.py     # el estilo de los comandos (mayúsculas, ===)
python prueba_plan.py        # notas de VLAN, EtherChannel, STP y router-on-a-stick
python prueba_enlaces.py     # corrección de enlaces mal tecleados
python prueba_completa.py    # práctica en blanco: todo sale de las notas
python prueba_rehacer.py     # práctica a medias y mal hecha: se rehace lo que hace falta
python prueba_escribir.py    # el .pkt configurado: running-config, VLANs y releerlo
python prueba_instalador.py  # instala en una carpeta temporal y desinstala
```

`prueba_instalador.py` no toca tu menú Inicio ni tu escritorio: instala en una
carpeta temporal y usa una clave de prueba del registro, que borra al
terminar.
