/** Type declaration for SCSS CSS Modules — allows `import s from '*.module.scss'` */
declare module '*.module.scss' {
  const classes: { readonly [key: string]: string };
  export default classes;
}
