# PktRutas

Genera la configuración Cisco de tus prácticas de Packet Tracer. Lee el `.pkt`
y saca lo que le falta: hostnames, enlaces /30, ruteo estático, VLANs, SVI o
subinterfaces, DHCP, troncales, EtherChannel y la raíz de STP. Si la práctica
está en blanco, la configura completa con lo que pones en el lienzo: el nombre
de cada equipo, las notas de los enlaces y las notas con las redes y VLANs.

La ventana es como el Bloc de notas: abres la práctica y la hoja se llena con
los comandos de cada equipo, listos para pegar en su CLI. También guarda una
copia del `.pkt` con todo ya aplicado, para abrirla en Packet Tracer (8.2 a
9.x).

![PktRutas con una práctica en blanco cargada](docs/ventana.png)

## Instalación

Necesitas Windows y [Python 3.10 o más nuevo](https://www.python.org/downloads/),
instalado con las opciones que trae marcadas (incluyen tkinter, la ventana).

1. Descarga el `PktRutas-x.y.z.zip` de la versión más nueva, en
   [Releases](https://github.com/QuesitoOaxaca21/PktRutas/releases/latest).
2. Clic derecho sobre el zip → **Extraer todo**.
3. En la carpeta que sale, doble clic en **`Instalar.bat`**.

Queda en el menú Inicio, en el escritorio y en el menú **Enviar a**: clic
derecho sobre un `.pkt` → Enviar a → PktRutas lo abre ya analizado. Se instala
sólo para tu usuario, sin permisos de administrador. Para actualizar, corre el
`Instalar.bat` de la versión nueva; para quitarlo, **Configuración →
Aplicaciones → PktRutas → Desinstalar**.

Si prefieres no instalarlo, dentro de la carpeta descomprimida da doble clic en
`Analizar.bat` (o arrastra un `.pkt` encima).

> **¿Por qué un `.bat` y no un `.exe`?** Windows 11 bloquea los `.exe` sin firma
> digital (Control inteligente de aplicaciones) y SmartScreen los marca como
> peligrosos. El instalador y el programa corren con el Python de python.org,
> que sí viene firmado, así que Windows los deja pasar.

## Uso

### 1. Prepara la práctica en Packet Tracer

1. Arma la topología y cablea. Cámbiale el nombre en el lienzo a cada router,
   core y switch (`R1`, `SWR1`, `sw10`); dentro de los equipos no hace falta
   configurar nada.
2. Junto a cada cable entre routers y cores pon una **nota** (Place Note, tecla
   `N`) con su /30: `.4`, `.8`, `.12`...
3. Junto a cada red pon una nota con el nombre de su router o core, su **red
   base** y la diagonal de cada VLAN:

   ```
   R1 16.0.0.0
   VLAN 2/17
   VLAN 3/24
   VLAN 4/25
   ```

4. A cada PC ponle su VLAN en el nombre: `PC1 V3`, `V4 PC2`, `PC7 VLAN5`.
5. Guarda (`Ctrl+S` en Packet Tracer).

Lo que ya hayas configurado a mano se respeta y sólo se genera lo que falta:
si los hostnames y los enlaces ya están puestos, los pasos 1 y 2 sobran.

### 2. Ábrela en PktRutas

**Archivo → Abrir .pkt** (`Ctrl+O`). La hoja se llena con los comandos de cada
equipo, en el orden en que conviene configurarlos (routers, cores y switches),
con el estilo de las prácticas: en mayúsculas, sin comentarios y con `===`
entre un equipo y otro.

```
EN
CONF T
HOSTNAME R2

INT FA0/0
IP ADD 12.0.0.6 255.255.255.252
NO SHUT

INT FA0/1
IP ADD 12.0.0.9 255.255.255.252
NO SHUT
===
EN
CONF T
HOSTNAME R3
...
```

Los nombres que tú pusiste (el hostname, el de una VLAN) se respetan tal cual:
`HOSTNAME sw10` y no `SW10`, para no renombrar el equipo. Si ya configuraste
algo, en la hoja sólo sale lo que falta; si no falta nada, sale la
configuración completa de cada equipo.

La barra de abajo dice cuántos equipos hay por configurar y si hay errores o
avisos; el detalle está en **Ver → Reporte completo** (`Ctrl+R`), que se abre
en el Bloc de notas con el plan de VLANs, la revisión y el detalle del ruteo.

### 3. Copia los comandos o guarda el .pkt configurado

`Ctrl+Enter` (**Editar → Copiar siguiente equipo**) copia el bloque del
siguiente equipo, lo deja seleccionado en la hoja y la barra dice de quién es
y cuántos faltan; lo pegas en su CLI. Como en el Bloc de notas, también puedes
seleccionar a mano, cambiar algo antes de copiar o guardar todo como `.txt`
(`Ctrl+S`).

![Un equipo recién copiado con Ctrl+Enter](docs/copiado.png)

O **Archivo → Guardar .pkt configurado** (`Ctrl+Mayús+S`): escribe una copia de
la práctica con todo ya aplicado, como si hubieras pegado los comandos. El
original no se toca.

La guía completa, con capturas y qué hacer si algo no sale, viene en
`GUIA.html`; en el programa, **Ayuda → Guía de uso**.

## Las notas, a detalle

### El nombre de cada equipo

El hostname sale del nombre que el equipo tiene en el lienzo (Config → Display
Name), siempre que todavía tenga el de fábrica (`Router` o `Switch`): `R1` en
el lienzo da `hostname R1`. Así las notas, el reporte y la CLI hablan del mismo
equipo.

* Un hostname que ya configuraste no se toca.
* Los nombres que Packet Tracer pone solo (`Router0`, `Switch3`,
  `Multilayer Switch1`) no se usan.
* Los espacios se vuelven guiones (`Router Central` → `Router-Central`) y
  tiene que empezar con letra; si no se puede, el reporte lo avisa.

### Las notas de enlace

Cada cable entre routers y cores toma su /30 de la nota que tenga más cerca
(a menos de unos 200 px del centro del cable):

* Se escribe `.4`, `.4/30`, `16.0.0.4` o `16.0.0.4/30`. La nota dice el /30
  que contiene esa dirección, así que `.4`, `.5` y `.6` dicen lo mismo: hay
  prácticas con cada costumbre.
* La IP más baja va al router (los routers antes que los cores) y, entre dos
  del mismo tipo, al de menor nombre: R1 .5, R2 .6. En el core, el puerto
  sale con `no switchport`.
* Los tres primeros octetos salen de tus enlaces ya configurados. En una
  práctica en blanco, de la nota que traiga la dirección completa
  (`12.0.0.4`), y si ninguna la trae, de la red base de las notas de VLAN. Si
  tus enlaces van en una red distinta a la de las VLANs, o la práctica no
  tiene VLANs, escribe completa al menos una nota.
* Un cable sin nota toma el primer /30 libre desde la .4, y el reporte lo
  avisa por si tu práctica pide otro.
* Entre dos cores el cable se configura sólo si tiene su nota: sin ella
  puede ser una troncal a propósito.
* Los enlaces se resuelven antes que las VLANs, así que las redes de las
  VLANs nunca los pisan.

Si en los enlaces que ya traen IP la mayoría de las notas no coincide con su
/30, en esa práctica las notas significan otra cosa y no se usan. Una nota que
no coincide con su enlace ya configurado se avisa, pero no se cambia nada.

### Las notas de VLANs

Cuatro formas, y se pueden mezclar:

* **La red base y la diagonal de cada VLAN** (VLSM), como en el ejemplo de
  arriba. Sin diagonal en la base, se reparte desde esa dirección dentro de
  la red de su clase (16.0.0.0 → /8). Si varias redes traen la misma base,
  quedan una tras otra: primero los routers (R1, R2...) y luego los cores.
* **Sólo la red base** (`R1 16.1.0.0/16`): se reparte en partes iguales entre
  las VLANs de las PCs de esa red (2 VLANs, mitades; 3 o 4, cuartos). Si
  algo de la práctica ya ocupa parte de la base, las partes se achican hasta
  caber y el reporte lo avisa.
* **La red base y cuántos equipos lleva cada VLAN**: VLSM igual que con la
  diagonal (`VLAN 3 500`, `VLAN 4 VENTAS 120`); a cada VLAN le toca el bloque
  más chico donde quepan sus equipos más la red y el broadcast.
* **La red de cada VLAN**, escrita por ti:

  ```
  SWR1
  VLAN 3 12.1.0.0/16
  VLAN 4 12.4.0.0 255.252.0.0
  VLAN 5 CINCO 12.0.0.128/25
  ```

Con tamaños (diagonal o usuarios) va de la VLAN más grande a la más chica y
cada una toma el primer bloque libre desde la base, saltándose lo que ya usa
la práctica (los enlaces, otras VLANs); el orden en que las escribas no
importa. Si la lista de la nota trae VLANs, esa lista manda sobre las PCs. El
pool de DHCP de cada VLAN sale de la misma cuenta que su SVI o subinterfaz,
así que su `default-router` siempre es la IP de esa interfaz.

Al escribir una red:

* Con diagonal (`12.1.0.0/16`), con máscara completa (`12.4.0.0 255.252.0.0`)
  o con tu estilo de siempre: `VLAN 2` en un renglón y abajo
  `red - broadcast - máscara`, con la máscara abreviada (`255.192`, `252.0`,
  `.248`) o las direcciones recortadas (`3.0 - 3.255 255.0`; los octetos que
  faltan se toman de los enlaces /30).
* El nombre de la VLAN es opcional; si no lo pones se usa el número en letra
  (`VLAN 3` → `TRES`), como en las prácticas.
* La puerta de enlace es la **última dirección utilizable**. Para otra, agrega
  `gw 12.1.0.1` en el renglón.
* Una sola nota puede describir varios sitios: cada renglón con un hostname
  abre un sitio nuevo.
* Tolera erratas comunes (`17.1.128..0`) y avisa cuando la máscara no cuadra
  con el rango, en vez de adivinar en silencio.

Las notas de enlace no estorban a las de VLANs: como plan de VLANs sólo se
leen las notas que traen un hostname con red o la palabra VLAN.

### De qué equipo es cada nota de VLANs

Se decide así, en orden: por el **hostname** escrito en la nota; si no trae,
porque sus redes **ya están configuradas** en algún equipo; y si tampoco, por
**cercanía** en el lienzo. La cercanía falla con facilidad, así que cuando se
usa el reporte lo avisa para que agregues el nombre.

## Qué genera y qué corrige

### Qué genera

* **Hostnames y enlaces**: del nombre en el lienzo y de las notas de enlace.
* **Core multicapa**: `ip routing`, las VLANs, una SVI y un pool de DHCP por
  VLAN, y las troncales hacia sus switches (con `encapsulation dot1q`).
* **Router** (router-on-a-stick): `no shutdown` en el puerto hacia el switch,
  una subinterfaz `encapsulation dot1Q` por VLAN y su pool de DHCP.
* **Switches del sitio**: las VLANs con nombre, las troncales, EtherChannel en
  los cables paralelos, la raíz de STP y un puerto de acceso por PC.
* **Ruteo estático** en todos, ya con las redes de las VLANs.

Dos reglas salen de cómo se resuelven estas prácticas a mano:

* **Raíz de STP**: el switch pegado al core o al router, sólo si el sitio
  tiene switches colgados de otros. Se pone la prioridad 4096 para la VLAN 1
  **y** para las del sitio: con PVST cada VLAN elige su raíz aparte, y si sólo
  se ajusta la 1, en las demás la decide la MAC más baja.
* **EtherChannel**: dos o más cables entre los mismos dos switches. `active`
  el más cercano al core, `passive` el otro.

Lo que ya tengas puesto no se repite en "Comandos por aplicar"; en
"Configuración completa" sale todo.

### Qué corrige solo

En los enlaces /30 revisa cada cable entre routers y cores:

* **IP que es de otro enlace**: si un extremo tiene una IP que ya es de otro
  equipo, o cae en la red de otro enlace, la cambia por la que le toca junto a
  su vecino.
* **Máscara distinta** a la del vecino: la iguala a la de tus enlaces.
* **La misma IP en los dos extremos**: al de menor nombre le deja la más baja.
* **Un extremo sin IP**: lo completa con la otra dirección del /30 (en un core,
  con `no switchport`).
* **Cable sin IP en ningún lado**: toma el /30 de su nota o, sin nota, el
  primero libre desde la .4 de tus enlaces, sin pisar ninguna red, y te lo
  dice por si tu práctica pide otro.
* **Puerto con IP pero apagado**: agrega `no shutdown`.

El arreglo va en los comandos de ese equipo, con un comentario `!` que dice qué
se cambió, y el ruteo se calcula ya con la red corregida. Cuando los dos lados
son igual de sospechosos no adivina: da las dos opciones y no toca nada.

En las notas corrige erratas (`17.1.128..0`), la máscara que no cuadra con el
rango o la diagonal, la dirección que no es de red y la puerta de enlace fuera
de la red, y avisa cada vez. Lo que no corrige son dos VLANs que se enciman:
no hay forma de saber cuál querías mover, así que dice cuáles chocan.

### El .pkt configurado

La copia lleva hostnames, enlaces, ruteo, VLANs, SVI o subinterfaces, DHCP,
troncales, EtherChannel, STP, puertos de acceso y las correcciones de los
enlaces. Las PCs del plan quedan en DHCP y recuperan su nombre original
(`PC1 V3` queda como `PC1`), porque en la copia la VLAN ya vive en el puerto
del switch; si dos quedarían con el mismo nombre, la segunda se deja igual y
se avisa. Por omisión se llama `<práctica>_configurado.pkt`, y antes de
guardarla el programa la vuelve a leer para comprobar que ya no le falte nada.

El programa lee el archivo como está guardado en disco: si tienes cambios en
Packet Tracer, guárdalos antes.

## La ventana

Es como el Bloc de notas de Windows 11, y sigue su tema claro u oscuro: la
barra de menú (**Archivo, Editar, Ver, Ayuda**), la hoja con los comandos y la
barra de estado con el mensaje, la línea y columna, el zoom, el fin de línea y
la codificación. La hoja se puede editar, deshacer, acercar o alejar y ajustar
al ancho de la ventana, como en el Bloc de notas. Se mueve con la rueda del
mouse o el touchpad; las barras de desplazamiento son delgadas, como las de
Windows 11: se asoman al mover el puntero y se esconden solas. Ningún error
cierra el programa: se avisa en la barra de estado, en rojo.

| Tecla | Acción |
|---|---|
| `Ctrl+O` | Abrir una práctica (`.pkt`) |
| `F5` | Volver a cargarla, después de guardar cambios en Packet Tracer |
| `Ctrl+Enter` | Copiar el siguiente equipo |
| `Ctrl+S` | Guardar los comandos como `.txt` |
| `Ctrl+Mayús+S` | Guardar el `.pkt` configurado |
| `Ctrl+R` | Ver el reporte completo, en el Bloc de notas |
| `Ctrl+Mayús+C` | Copiar todos los comandos |
| `Ctrl+Más` / `Ctrl+Menos` / `Ctrl+0` | Acercar / alejar / restaurar el zoom |
| `Ctrl+Q` | Salir |

## Más detalles

Cómo calcula el ruteo, de dónde saca la configuración del `.pkt`, cómo escribe
la copia configurada, cómo funciona el instalador, la estructura del código y
las pruebas: [`docs/TECNICO.md`](docs/TECNICO.md).

PktRutas sólo usa la biblioteca estándar de Python, incluido el descifrado del
`.pkt` (Twofish implementado desde cero).
