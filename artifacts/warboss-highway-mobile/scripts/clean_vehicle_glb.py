"""Clean up an image-to-3D vehicle GLB for use in the game.

Generated meshes arrive with problems the renderer would otherwise have to
guess around:
  * stray "floater" fragments far from the body, which inflate the bounding
    box the game uses to size and ground the car;
  * an arbitrary heading (this tool turns the nose to +Z, the convention
    VehicleMesh.tsx expects);
  * a texture far larger than a phone needs.

It bakes node transforms, drops triangles outside a robust bounding box,
re-centres the car on X/Z with its lowest point at y = 0, and re-encodes the
base-colour texture as a baseline JPEG.

usage:
  python clean_vehicle_glb.py IN.glb OUT.glb --nose {+x,-x,+z,-z} [--texture 1024]

  --nose     which axis the car's nose points along in the SOURCE file
  --texture  longest side of the output texture in pixels (default 1024)

Requires numpy and Pillow. Run with `python -I` when the input is a download.
"""
import argparse
import io
import json
import struct

import numpy as np
from PIL import Image

COMPONENT = {5120: 'b', 5121: 'B', 5122: 'h', 5123: 'H', 5125: 'I', 5126: 'f'}
WIDTH = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
# Rotation about Y that carries the source nose axis onto +Z, as (x, z) -> (x', z').
TURN = {
    '+z': lambda x, z: (x, z),
    '-z': lambda x, z: (-x, -z),
    '-x': lambda x, z: (z, -x),
    '+x': lambda x, z: (-z, x),
}


def read_glb(path):
    blob = open(path, 'rb').read()
    json_length = struct.unpack('<I', blob[12:16])[0]
    return json.loads(blob[20:20 + json_length]), blob[20 + json_length + 8:]


def accessor(gltf, binary, index):
    spec = gltf['accessors'][index]
    view = gltf['bufferViews'][spec['bufferView']]
    dtype = np.dtype('<' + COMPONENT[spec['componentType']])
    width = WIDTH[spec['type']]
    offset = view.get('byteOffset', 0) + spec.get('byteOffset', 0)
    stride = view.get('byteStride') or dtype.itemsize * width
    if stride == dtype.itemsize * width:
        data = np.frombuffer(binary, dtype=dtype, count=spec['count'] * width, offset=offset)
        return data.reshape(spec['count'], width).copy()
    rows = [np.frombuffer(binary, dtype=dtype, count=width, offset=offset + i * stride) for i in range(spec['count'])]
    return np.stack(rows)


def node_matrix(node):
    if 'matrix' in node:
        return np.array(node['matrix'], dtype=np.float64).reshape(4, 4).T
    x, y, z, w = node.get('rotation', [0, 0, 0, 1])
    rotation = np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])
    matrix = np.eye(4)
    matrix[:3, :3] = rotation * np.array(node.get('scale', [1, 1, 1]), dtype=np.float64)
    matrix[:3, 3] = node.get('translation', [0, 0, 0])
    return matrix


def gather(gltf, binary):
    """All triangles in world space: positions, normals, uvs, indices."""
    positions, normals, uvs, indices = [], [], [], []
    base = 0

    def walk(index, parent):
        nonlocal base
        node = gltf['nodes'][index]
        matrix = parent @ node_matrix(node)
        if 'mesh' in node:
            for primitive in gltf['meshes'][node['mesh']]['primitives']:
                attributes = primitive['attributes']
                p = accessor(gltf, binary, attributes['POSITION']).astype(np.float64)
                positions.append((matrix[:3, :3] @ p.T).T + matrix[:3, 3])
                if 'NORMAL' in attributes:
                    n = accessor(gltf, binary, attributes['NORMAL']).astype(np.float64)
                    n = (matrix[:3, :3] @ n.T).T
                    normals.append(n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-9))
                else:
                    normals.append(np.tile([0.0, 1.0, 0.0], (len(p), 1)))
                uv = accessor(gltf, binary, attributes['TEXCOORD_0']) if 'TEXCOORD_0' in attributes else np.zeros((len(p), 2))
                uvs.append(uv.astype(np.float64))
                idx = accessor(gltf, binary, primitive['indices']).reshape(-1) if 'indices' in primitive else np.arange(len(p))
                indices.append(idx.astype(np.int64) + base)
                base += len(p)
        for child in node.get('children', []):
            walk(child, matrix)

    for root in gltf['scenes'][gltf.get('scene', 0)]['nodes']:
        walk(root, np.eye(4))
    return np.concatenate(positions), np.concatenate(normals), np.concatenate(uvs), np.concatenate(indices).reshape(-1, 3)


def drop_floaters(positions, triangles):
    """Keep triangles whose vertices all sit inside a robust bounding box."""
    low = np.percentile(positions, 0.5, axis=0)
    high = np.percentile(positions, 99.5, axis=0)
    margin = (high - low) * 0.08
    inside = np.all((positions >= low - margin) & (positions <= high + margin), axis=1)
    return triangles[np.all(inside[triangles], axis=1)]


def compact(positions, normals, uvs, triangles):
    used = np.unique(triangles)
    remap = np.full(len(positions), -1, dtype=np.int64)
    remap[used] = np.arange(len(used))
    return positions[used], normals[used], uvs[used], remap[triangles]


def texture_bytes(gltf, binary, max_size):
    image = gltf['images'][0]
    view = gltf['bufferViews'][image['bufferView']]
    start = view.get('byteOffset', 0)
    picture = Image.open(io.BytesIO(binary[start:start + view['byteLength']])).convert('RGB')
    scale = max_size / max(picture.size)
    if scale < 1:
        picture = picture.resize((round(picture.width * scale), round(picture.height * scale)), Image.LANCZOS)
    out = io.BytesIO()
    # Baseline (non-progressive) JPEG: the decoder on device is stb_image.
    picture.save(out, 'JPEG', quality=88, progressive=False)
    return out.getvalue(), picture.size


def pad4(data, fill=b'\x00'):
    return data + fill * ((4 - len(data) % 4) % 4)


def write_glb(path, positions, normals, uvs, triangles, jpeg):
    binary = bytearray()
    views = []

    def add_view(data, target=None):
        view = {'buffer': 0, 'byteOffset': len(binary), 'byteLength': len(data)}
        if target is not None:
            view['target'] = target
        binary.extend(pad4(data))
        views.append(view)
        return len(views) - 1

    p = positions.astype('<f4')
    n = normals.astype('<f4')
    t = uvs.astype('<f4')
    i = triangles.astype('<u4').reshape(-1)
    accessors = [
        {'bufferView': add_view(p.tobytes(), 34962), 'componentType': 5126, 'count': len(p), 'type': 'VEC3',
         'min': p.min(0).tolist(), 'max': p.max(0).tolist()},
        {'bufferView': add_view(n.tobytes(), 34962), 'componentType': 5126, 'count': len(n), 'type': 'VEC3'},
        {'bufferView': add_view(t.tobytes(), 34962), 'componentType': 5126, 'count': len(t), 'type': 'VEC2'},
        {'bufferView': add_view(i.tobytes(), 34963), 'componentType': 5125, 'count': len(i), 'type': 'SCALAR'},
    ]
    image_view = add_view(jpeg)
    gltf = {
        'asset': {'version': '2.0', 'generator': 'clean_vehicle_glb.py'},
        'scene': 0,
        'scenes': [{'nodes': [0]}],
        'nodes': [{'mesh': 0}],
        'meshes': [{'primitives': [{'attributes': {'POSITION': 0, 'NORMAL': 1, 'TEXCOORD_0': 2}, 'indices': 3, 'material': 0}]}],
        'materials': [{'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}, 'metallicFactor': 0, 'roughnessFactor': 0.6}}],
        'textures': [{'source': 0}],
        'images': [{'bufferView': image_view, 'mimeType': 'image/jpeg'}],
        'accessors': accessors,
        'bufferViews': views,
        'buffers': [{'byteLength': len(binary)}],
    }
    json_chunk = pad4(json.dumps(gltf, separators=(',', ':')).encode('utf-8'), b' ')
    total = 12 + 8 + len(json_chunk) + 8 + len(binary)
    with open(path, 'wb') as handle:
        handle.write(struct.pack('<4sII', b'glTF', 2, total))
        handle.write(struct.pack('<I4s', len(json_chunk), b'JSON'))
        handle.write(json_chunk)
        handle.write(struct.pack('<I4s', len(binary), b'BIN\x00'))
        handle.write(binary)
    return total


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('source')
    parser.add_argument('output')
    parser.add_argument('--nose', required=True, choices=sorted(TURN))
    parser.add_argument('--texture', type=int, default=1024)
    args = parser.parse_args()

    gltf, binary = read_glb(args.source)
    positions, normals, uvs, triangles = gather(gltf, binary)
    before = len(triangles)
    triangles = drop_floaters(positions, triangles)
    positions, normals, uvs, triangles = compact(positions, normals, uvs, triangles)

    turn = TURN[args.nose]
    positions[:, 0], positions[:, 2] = turn(positions[:, 0].copy(), positions[:, 2].copy())
    normals[:, 0], normals[:, 2] = turn(normals[:, 0].copy(), normals[:, 2].copy())
    low, high = positions.min(0), positions.max(0)
    positions[:, 0] -= (low[0] + high[0]) / 2
    positions[:, 2] -= (low[2] + high[2]) / 2
    positions[:, 1] -= low[1]

    jpeg, texture_size = texture_bytes(gltf, binary, args.texture)
    total = write_glb(args.output, positions, normals, uvs, triangles, jpeg)
    size = positions.max(0) - positions.min(0)
    print(f'triangles {before} -> {len(triangles)} ({before - len(triangles)} dropped as floaters)')
    print(f'size x={size[0]:.3f} y={size[1]:.3f} z={size[2]:.3f}  width/length={size[0] / size[2]:.3f}')
    print(f'texture {texture_size[0]}x{texture_size[1]} {len(jpeg) // 1024} KB; wrote {args.output} {total // 1024} KB')


main()
