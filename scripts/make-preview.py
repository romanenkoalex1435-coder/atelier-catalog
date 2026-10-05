#!/usr/bin/env python3
"""One-time preview preparation: cut an item out of a photo on the rug and save a transparent 4:5 WebP.

    pip install rembg onnxruntime pillow numpy scipy
    python3 scripts/make-preview.py images/p-abc.jpg --id p-abc --kind top

Runs once per item (never in the browser or at page load). The original photo is not touched.
The script refuses to write a preview when its own checks fail, so the catalog keeps showing the whole original photo.
Kinds set the visual scale so similar garments look alike and accessories are not blown up to jacket size:
  top        width of the item = 100% of the frame (shirts, jackets, sweaters, tees)
  bottom     height of the item = 100% of the frame (trousers, jeans, skirts)
  accessory  longest side = 60% of the frame (belts, bags, hats, scarves)
The page adds a 7% inner padding around the image, so the item never touches the tile edge.
"""
import argparse, sys
import numpy as np
from PIL import Image
from scipy import ndimage
from rembg import remove, new_session

W, H = 800, 1000
FIT = {'top': ('w', 1.0), 'bottom': ('h', 1.0), 'accessory': ('max', 0.6)}

def checks(alpha):
    a = alpha.astype(np.float32) / 255
    solid = a > .5
    share = solid.mean()
    labels, n = ndimage.label(solid)
    sizes = ndimage.sum(solid, labels, range(1, n + 1)) if n else []
    main = max(sizes) if len(sizes) else 0
    soft = ((a > .08) & (a < .92)).sum() / max(solid.sum(), 1)  # share of half-transparent pixels along the edge
    # transparent or half-transparent areas enclosed inside the item mean a lost detail (a label, a pocket, a button) replaced by background
    filled = ndimage.binary_fill_holes(solid)
    hole = (filled & ~solid).sum() / max(filled.sum(), 1)
    soft_inner = ndimage.binary_erosion(filled, iterations=4) & (a > .04) & (a < .96)
    blobs, nb = ndimage.label(soft_inner)
    smear = int(max(ndimage.sum(soft_inner, blobs, range(1, nb + 1)))) if nb else 0
    problems = []
    if hole > .0005: problems.append(f'a hole covers {hole:.2%} of the item (a detail may be lost)')
    if smear > 120: problems.append(f'a half-transparent patch of {smear} px inside the item (a detail may be lost)')
    if share < .08 or share > .85: problems.append(f'item covers {share:.0%} of the photo')
    if main and main / solid.sum() < .93: problems.append('item is split into several large pieces')
    if soft > .06: problems.append(f'edge is too soft/noisy ({soft:.1%})')
    return problems, share

def main():
    p = argparse.ArgumentParser()
    p.add_argument('src'); p.add_argument('--id', required=True); p.add_argument('--kind', choices=FIT, default='top')
    p.add_argument('--out', default='images/preview'); p.add_argument('--force', action='store_true', help='write even if checks fail (for inspection only)')
    args = p.parse_args()
    src = Image.open(args.src).convert('RGB')
    cut = remove(src, session=new_session('birefnet-general-lite'))
    alpha = np.array(cut.split()[3])
    # drop tiny stray islands only; edges are not blurred, eroded, filled or redrawn
    solid = alpha > 24
    labels, n = ndimage.label(solid)
    if n > 1:
        sizes = ndimage.sum(solid, labels, range(1, n + 1))
        keep = np.isin(labels, [i + 1 for i, s in enumerate(sizes) if s >= .002 * solid.size])
        alpha = np.where(keep, alpha, 0).astype(np.uint8)
    problems, share = checks(alpha)
    if problems and not args.force:
        print(f'REJECTED {args.id}: ' + '; '.join(problems) + ' -> the original photo stays in the catalog'); return 2
    cut.putalpha(Image.fromarray(alpha))
    box = cut.getchannel('A').point(lambda v: 255 if v > 24 else 0).getbbox()
    item = cut.crop(box)
    axis, ratio = FIT[args.kind]
    scale = {'w': W * ratio / item.width, 'h': H * ratio / item.height, 'max': min(W, H) * ratio / max(item.size)}[axis]
    scale = min(scale, W / item.width, H / item.height)  # always fits the frame
    item = item.resize((max(1, round(item.width * scale)), max(1, round(item.height * scale))), Image.LANCZOS)
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    canvas.paste(item, ((W - item.width) // 2, (H - item.height) // 2), item)
    import os; os.makedirs(args.out, exist_ok=True)
    path = f'{args.out}/{args.id}.webp'
    canvas.save(path, 'WEBP', quality=92, alpha_quality=100, method=6)
    print(f'OK {path} ({os.path.getsize(path) // 1024} KB, item {share:.0%} of photo, kind={args.kind})' + (' [forced]' if problems else ''))

if __name__ == '__main__':
    sys.exit(main() or 0)
