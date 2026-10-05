# Control de baños

Web para que el profesorado registre las salidas al baño del alumnado.

- **Registrar**: elige la clase y pulsa en el alumno o alumna. Se guarda quién sale, de qué clase, a qué hora y qué profesor/a lo registra. En los 10 primeros y 10 últimos minutos de cada clase aparece un aviso y solo se puede registrar como **urgencia**. La vuelta es opcional (botón «Ha vuelto»).
- **Historial**: el icono 🕘 de cada alumno/a muestra sus salidas de hoy, de la semana, del mes y del curso.
- **Informes**: filtros por centro, clase o alumno/a; por hoy, semana, mes, curso, un día o entre fechas; por tramo horario, entre horas o solo los minutos no permitidos; y solo urgencias. Se puede **descargar en PDF** (solo resumen, solo detalle o ambos) o en CSV para Excel.

## Probarla ahora (modo prueba)

Con `supabaseUrl` vacío en `config.js`, la web funciona sin servidor: guarda los datos solo en tu navegador y usa las listas reales de `data/demo-data.js`. Abre `index.html` con doble clic o arrastrándolo a Chrome. Con «Generar salidas de ejemplo» puedes ver cómo quedan los informes.

## Antes de usarla de verdad

1. **Horario**: corrige los tramos en `config.js` (`horario`) con las horas reales del centro.
2. **Base de datos (Supabase, gratis)**
   - Crea una cuenta en https://supabase.com, preferiblemente con un correo del centro, y crea un proyecto en la región «West EU».
   - En *SQL Editor*, pega y ejecuta `supabase/schema.sql` y después `supabase/seed.sql`.
   - En *Project Settings → API*, copia la *Project URL* y la clave *anon public* en `config.js`.
3. **Acceso con Microsoft 365**: lo hace el responsable de informática de salesianas.org.
   - En https://entra.microsoft.com → *Registros de aplicaciones → Nuevo registro*, con la URI de redirección `https://<tu-proyecto>.supabase.co/auth/v1/callback`.
   - Crea un *secreto de cliente*.
   - En Supabase → *Authentication → Providers → Azure*, pega el ID de aplicación, el secreto y la URL del inquilino: `https://login.microsoftonline.com/<ID-del-inquilino>`. Así solo pueden entrar cuentas del centro.
   - En *Authentication → URL Configuration*, añade como *Site URL* la dirección de la web.
   - Desactiva el acceso por correo y contraseña (*Providers → Email*).
4. **Publicar (Vercel, gratis)**: crea una cuenta en https://vercel.com y sube la carpeta con `npx vercel`. El archivo `.vercelignore` impide que se publiquen las listas, los PDF y los scripts.

## Seguridad y datos

- Nombres del alumnado y salidas solo se guardan en la base de datos. Solo se pueden leer con una sesión iniciada con una cuenta **@salesianas.org** (reglas RLS en `schema.sql`); la web publicada no contiene ningún dato.
- Cada registro queda firmado con el correo de quien lo hizo y no se puede falsear. Solo quien creó un registro puede borrarlo. Cualquier profesor/a puede marcar la vuelta.
- Al acabar el curso, conviene descargar los informes que se quieran conservar y vaciar la tabla `salidas`.

## Nuevo curso o cambios de lista

Con los PDF de Séneca, ejecuta lo siguiente (requiere `pip install pypdf`):

```
python3 scripts/generar-datos.py "Listas ESO.pdf" "Listas Bach.pdf"
```

Después vuelve a ejecutar `supabase/seed.sql` (borra también las salidas). Si una clase cambia de nombre en Séneca, añádela en el diccionario `NOMBRES` del script.
