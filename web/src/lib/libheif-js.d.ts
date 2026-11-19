declare module "libheif-js" {
  interface HeifImage {
    get_width(): number;
    get_height(): number;
    display(data: ImageData, done: (result: ImageData | null) => void): void;
  }
  const libheif: {
    HeifDecoder: new () => { decode(bytes: Uint8Array): HeifImage[] };
  };
  export default libheif;
}
