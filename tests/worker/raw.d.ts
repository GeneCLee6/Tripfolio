// Vite's ?raw imports (used by the fake D1 to load the migrations)
declare module '*.sql?raw' {
  const sql: string
  export default sql
}
