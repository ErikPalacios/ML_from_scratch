// Un .zip sin dependencias (deflate con zlib de Node). Suficiente para los kits: archivos de texto y pocos KB.
import { deflateRawSync, crc32 } from 'node:zlib';

const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };

// Fecha fija: el mismo contenido da el mismo .zip byte por byte (y el mismo hash del build).
const DOS_TIME = 0, DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

/** archivos: [{ name: 'carpeta/archivo.py', data: Buffer, mode?: 0o755 }] → Buffer */
export function zip(archivos) {
  const locales = [], centrales = [];
  let off = 0;
  for (const { name, data, mode = 0o644 } of archivos) {
    const nombre = Buffer.from(name, 'utf8');
    const comp = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const comun = [u16(20), u16(0x0800), u16(8), u16(DOS_TIME), u16(DOS_DATE), u32(crc), u32(comp.length), u32(data.length), u16(nombre.length), u16(0)];
    const local = Buffer.concat([u32(0x04034b50), ...comun, nombre, comp]);
    centrales.push(Buffer.concat([u32(0x02014b50), u16(0x0314), ...comun, u16(0), u16(0), u16(0), u32(((0o100000 | mode) << 16) >>> 0), u32(off), nombre]));
    locales.push(local);
    off += local.length;
  }
  const central = Buffer.concat(centrales);
  const fin = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(archivos.length), u16(archivos.length), u32(central.length), u32(off), u16(0)]);
  return Buffer.concat([...locales, central, fin]);
}
