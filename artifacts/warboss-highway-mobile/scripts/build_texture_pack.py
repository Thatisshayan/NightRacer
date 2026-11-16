"""Pack 2D art into a single GLB so the app can load it as textures.

Why a GLB and not loose image files: this app renders with three.js on
expo-gl, where there is no DOM <img>. Textures embedded in a GLB load through
the same GLTFLoader path as the vehicle models, which is proven on device.
Handing expo-gl a loose image file to decode was tried and silently failed
(see audits/2026-11-15_Claude_NativeVisualQA_Audit.md, finding 26).

The GLB holds one throwaway triangle per image; the app ignores the geometry
and reads each material's base-colour texture, keyed by material name (see
components/game3d/texturePack.ts).

usage:
  python build_texture_pack.py OUT.glb NAME=IMAGE[,MAXSIZE[,FORMAT]] ...

  MAXSIZE  longest side in pixels after resizing (default 512)
  FORMAT   jpg (default) or png (keeps alpha)

Requires Pillow. Run with `python -I` when the inputs are downloaded files.
"""
import io
import json
import struct
import sys

from PIL import Image


def encode(path, max_size, fmt):
    image = Image.open(path)
    image = image.convert('RGBA' if fmt == 'png' else 'RGB')
    scale = max_size / max(image.size)
    if scale < 1:
        image = image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))), Image.LANCZOS)
    out = io.BytesIO()
    if fmt == 'png':
        image.save(out, 'PNG', optimize=True)
    else:
        # Baseline (non-progressive) JPEG: the decoder on device is stb_image.
        image.save(out, 'JPEG', quality=86, progressive=False)
    return out.getvalue(), image.size


def pad4(data, fill=b'\x00'):
    return data + fill * ((4 - len(data) % 4) % 4)


def main():
    out_path, specs = sys.argv[1], sys.argv[2:]
    binary = bytearray()
    views, accessors, images, textures, materials, meshes, nodes = [], [], [], [], [], [], []

    def add_view(data, target=None):
        offset = len(binary)
        binary.extend(pad4(data))
        view = {'buffer': 0, 'byteOffset': offset, 'byteLength': len(data)}
        if target is not None:
            view['target'] = target
        views.append(view)
        return len(views) - 1

    positions = struct.pack('<9f', 0, 0, 0, 1, 0, 0, 0, 1, 0)
    uvs = struct.pack('<6f', 0, 1, 1, 1, 0, 0)
    accessors.append({'bufferView': add_view(positions, 34962), 'componentType': 5126, 'count': 3, 'type': 'VEC3',
                      'min': [0, 0, 0], 'max': [1, 1, 0]})
    accessors.append({'bufferView': add_view(uvs, 34962), 'componentType': 5126, 'count': 3, 'type': 'VEC2'})

    for index, spec in enumerate(specs):
        name, rest = spec.split('=', 1)
        parts = rest.split(',')
        path = parts[0]
        max_size = int(parts[1]) if len(parts) > 1 else 512
        fmt = parts[2] if len(parts) > 2 else 'jpg'
        data, size = encode(path, max_size, fmt)
        images.append({'bufferView': add_view(data), 'mimeType': 'image/png' if fmt == 'png' else 'image/jpeg'})
        textures.append({'source': index})
        material = {'name': name, 'pbrMetallicRoughness': {'baseColorTexture': {'index': index},
                                                            'metallicFactor': 0, 'roughnessFactor': 1}}
        if fmt == 'png':
            material['alphaMode'] = 'BLEND'
        materials.append(material)
        meshes.append({'name': name, 'primitives': [{'attributes': {'POSITION': 0, 'TEXCOORD_0': 1}, 'material': index}]})
        nodes.append({'name': name, 'mesh': index})
        print(f'{name:16s} {size[0]}x{size[1]} {fmt} {len(data) // 1024} KB')

    gltf = {
        'asset': {'version': '2.0', 'generator': 'build_texture_pack.py'},
        'scene': 0,
        'scenes': [{'nodes': list(range(len(nodes)))}],
        'nodes': nodes,
        'meshes': meshes,
        'materials': materials,
        'textures': textures,
        'images': images,
        'accessors': accessors,
        'bufferViews': views,
        'buffers': [{'byteLength': len(binary)}],
    }
    json_chunk = pad4(json.dumps(gltf, separators=(',', ':')).encode('utf-8'), b' ')
    total = 12 + 8 + len(json_chunk) + 8 + len(binary)
    with open(out_path, 'wb') as handle:
        handle.write(struct.pack('<4sII', b'glTF', 2, total))
        handle.write(struct.pack('<I4s', len(json_chunk), b'JSON'))
        handle.write(json_chunk)
        handle.write(struct.pack('<I4s', len(binary), b'BIN\x00'))
        handle.write(binary)
    print(f'wrote {out_path}: {total // 1024} KB, {len(specs)} textures')


main()
