// Renders public/favicon.ico (16/32/48 px PNG entries) from a 3x5 bitmap font:
// a plain "CO / ViS" mark, black on white, without depending on system fonts.
// Usage: pnpm exec tsx tools/create-favicon.ts
import { writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const GLYPHS: Record<string, string[]> = {
    C: ['111', '100', '100', '100', '111'], O: ['111', '101', '101', '101', '111'],
    V: ['101', '101', '101', '101', '010'], i: ['010', '000', '010', '010', '010'], S: ['111', '100', '111', '001', '111']
};
async function icon(size: number) {
    const scale = size / 16;
    const pixels = Buffer.alloc(size * size * 4, 255);
    const line = (text: string, top: number) => {
        const width = (text.length * 4 - 1) * scale;
        const left = Math.floor((size - width) / 2);
        [...text].forEach((char, index) => GLYPHS[char]!.forEach((row, y) => [...row].forEach((bit, x) => {
            if (bit !== '1') return;
            for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
                const o = ((top + y * scale + dy) * size + left + (index * 4 + x) * scale + dx) * 4;
                pixels[o] = 0; pixels[o + 1] = 0; pixels[o + 2] = 0;
            }
        })));
    };
    line('CO', 2 * scale);
    line('ViS', 9 * scale);
    return sharp(pixels, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
}
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map(icon));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((size, index) => {
    const entry = 6 + index * 16;
    header[entry] = size; header[entry + 1] = size;
    header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(images[index]!.length, entry + 8); header.writeUInt32LE(offset, entry + 12);
    offset += images[index]!.length;
});
await writeFile('public/favicon.ico', Buffer.concat([header, ...images]));
