/// <reference types="astro/client" />

declare module '*.astro' {
  const Component: (_props: any) => any;
  export default Component;
}
