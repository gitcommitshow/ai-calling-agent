/**
 * Next declares `*.module.css` but not plain global stylesheets, and TypeScript
 * checks side-effect imports, so `import './globals.css'` needs this.
 */
declare module '*.css' {
  const stylesheet: string;
  export default stylesheet;
}
