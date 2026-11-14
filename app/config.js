// Configuracion. Si dejas supabaseUrl vacio la app funciona en "modo local":
// los datos se guardan solo en este navegador (sirve para probar).
//
// Para compartir datos entre vuestros dos moviles, rellena estos dos valores con los de
// Supabase > Project Settings > API:
//   - "Project URL"
//   - "anon public" key  (es publica por diseño; la proteccion la dan las reglas de sql/schema.sql)
// NUNCA pongas aqui la clave "service_role".
export const config = {
  supabaseUrl: 'https://gwkhgdllflteiwllaobp.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd3a2hnZGxsZmx0ZWl3bGxhb2JwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ2NjE0MzEsImV4cCI6MjExMDIzNzQzMX0.EDuQsarO3-ICcJ8qbYsK0iYrMKgKkwcdM0gn7eY0HzE',
};
