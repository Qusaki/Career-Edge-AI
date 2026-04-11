
import struct
import json
import sys

def inspect_glb(filepath):
    try:
        with open(filepath, 'rb') as f:
            # GLB Header
            magic = f.read(4)
            if magic != b'glTF':
                print("Not a GLB file")
                return

            version = struct.unpack('<I', f.read(4))[0]
            length = struct.unpack('<I', f.read(4))[0]

            # First chunk (JSON)
            chunk_length = struct.unpack('<I', f.read(4))[0]
            chunk_type = f.read(4)
            if chunk_type != b'JSON':
                print("First chunk is not JSON")
                return

            json_data = f.read(chunk_length).decode('utf-8')
            data = json.loads(json_data)

            print("\n--- Meshes & Morph Targets ---")
            for meshIndex, mesh in enumerate(data.get('meshes', [])):
                meshName = mesh.get('name', f'Mesh_{meshIndex}')
                print(f"Mesh: {meshName}")
                
                # Try to get morph target names from 'extras' (common in exports)
                targetNames = mesh.get('extras', {}).get('targetNames', [])
                if targetNames:
                    print(f"  Target Names: {targetNames}")
                else:
                    # Check if primitives have targets even if names are missing
                    for prim in mesh.get('primitives', []):
                        if 'targets' in prim:
                            print(f"  (Mesh has {len(prim['targets'])} unnamed morph targets)")
                            break

    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    inspect_glb(sys.argv[1])
