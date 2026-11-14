# Comparador de la compra

App web instalable en el iPhone (PWA) que reparte la compra semanal entre Eroski, BM, Dia y Carrefour según el precio de cada producto.

- **BM y Eroski:** el precio se lee solo una vez al día.
- **Dia y Carrefour:** el precio se escribe a mano en la app (sus webs bloquean los programas automáticos y no se intenta esquivarlo).
- Los dos móviles comparten lista y precios en tiempo real (Supabase).

## Qué hay en la carpeta

| Carpeta | Contenido |
|---|---|
| `app/` | La app (HTML/JS sin dependencias). Pantallas: Lista, Precios, Productos, Ajustes |
| `scraper/` | Lector de precios de BM y Eroski (`node scraper/run.mjs ...`) |
| `sql/schema.sql` | Tablas y reglas de seguridad de Supabase |
| `data/ingredients.json` | Los 30 ingredientes de vuestro Excel con sus precios (punto de partida) |
| `.github/workflows/precios.yml` | Tarea diaria de GitHub que actualiza BM y Eroski |
| `tools/test_compare.mjs` | Pruebas de la lógica del reparto (`node tools/test_compare.mjs`) |

## 1. Probarla ya, sin cuentas (modo local)

```bash
python -m http.server 8000
```

Abre <http://localhost:8000/app/>. Los datos se guardan solo en ese navegador. Sirve para ver cómo funciona; para compartir entre móviles hay que seguir con el paso 2.

## 2. Elegir los productos de BM y Eroski (una sola vez)

```bash
node scraper/run.mjs candidatos
```

Busca cada ingrediente en BM y Eroski (tarda unos 2 minutos, con pausa entre consultas) y guarda `data/candidatos.json`. Después, en la app → **Productos** → **Elegir**, escogéis el producto concreto de cada ingrediente. Esa elección es la que se actualizará sola cada día.

## 3. Compartir entre los dos móviles (Supabase)

1. En Supabase, abre tu proyecto → **SQL Editor** → pega `sql/schema.sql` → **Run**.
2. **Authentication → Providers → Email**: deja el acceso por correo y **desactiva «Allow new users to sign up»**. Luego, en **Authentication → Users → Invite user**, invita vuestros dos correos. Así solo entráis vosotros.
3. **Project Settings → API**: copia la **Project URL** y la clave **anon public** en `app/config.js`. Nunca pongas ahí la clave `service_role`.
4. **(Ya hecho en vuestro proyecto: tablas creadas y 30 ingredientes con 114 precios cargados.)** Si algún día montáis otro proyecto, carga los ingredientes y precios del Excel (una vez), desde un terminal en esta carpeta:

   ```bash
   SUPABASE_URL=https://TU-PROYECTO.supabase.co SUPABASE_SERVICE_KEY=la-clave-service_role node scraper/run.mjs sembrar
   ```

   (En PowerShell: `$env:SUPABASE_URL="..."; $env:SUPABASE_SERVICE_KEY="..."; node scraper/run.mjs sembrar`.) La clave `service_role` es secreta: no la pegues en chats ni en archivos del repositorio.

## 4. Actualización diaria (GitHub)

1. Sube esta carpeta a un repositorio de GitHub.
2. En el repositorio: **Settings → Secrets and variables → Actions → New repository secret**. Crea `SUPABASE_URL` y `SUPABASE_SERVICE_KEY`.
3. Pestaña **Actions → Actualizar precios → Run workflow** para probarlo. Después se ejecuta solo cada día.

> **Riesgo conocido:** BM y Eroski pueden tratar distinto las peticiones que llegan desde los servidores de GitHub y bloquearlas. No se ha podido probar. Si falla, el mismo comando (`node scraper/run.mjs actualizar`) se puede lanzar cada día desde un PC de casa con el Programador de tareas de Windows.

## 5. Publicar la app e instalarla en los iPhones

- **GitHub Pages** (Settings → Pages → rama principal): la app quedará en `https://TU-USUARIO.github.io/TU-REPO/app/`. En cuentas gratuitas exige repositorio público; eso no expone nada secreto (la clave `anon` es pública por diseño y las reglas de `schema.sql` protegen los datos), pero sí quedarían visibles vuestros ingredientes.
- **Netlify** también sirve y admite repositorios privados.
- En **Supabase → Authentication → URL Configuration** pon esa dirección como *Site URL*.
- En cada iPhone: abre la dirección en **Safari** → Compartir → **Añadir a pantalla de inicio**.

## Productos al peso (€/kg)

Algunos ingredientes se compran por kilos (pollo, salmón, pimientos, patatas...). En **Productos** tienen el interruptor **Al peso**: su precio se guarda y se escribe en **€/kg**, y la cantidad de la lista se mide en gramos o kilos (botones de 250 g; pulsa la cantidad para escribir una exacta). Vienen marcados de partida los 14 que en vuestro Excel tienen precio por kilo; se cambia producto a producto. Al elegir un producto de BM o Eroski al peso, la app guarda su precio por kilo y solo deja elegir los que lo tienen.

## Cómo reparte la app

Para cada ingrediente elige la tienda activa más barata (por precio por kg/litro cuando todas lo tienen; si no, por precio del envase). Si ir a una tienda ahorra menos que el **ahorro mínimo** de Ajustes, sus productos pasan a otra tienda. Los precios con más días de los configurados aparecen como antiguos y la pestaña **Precios** os pide solo esos.

## Qué no está probado

- La parte de Supabase (inicio de sesión, guardado compartido, tiempo real): no he tenido acceso a vuestro proyecto.
- La ejecución en GitHub Actions y la instalación en iPhone.
- El *service worker* (uso sin conexión): el navegador de pruebas no lo permite.
- No hay icono PNG para iOS (Safari muestra una captura de la app en su lugar). Se puede añadir un `apple-touch-icon.png` de 180×180 más adelante.

## Uso responsable de los datos

Los `robots.txt` de BM (`/api/`) y Eroski (`/search/results/`) prohíben las rutas que usa el lector. Se usa por decisión expresa de los propietarios del proyecto, para uso personal, como mucho una vez al día, con pausa entre peticiones y un identificador claro (`AppSupermercados-personal`). Si una web responde con bloqueo, no se intenta evitar: ese precio se deja manual.
