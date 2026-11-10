"""Add qualified DLF lifecycle workflows to Clipper's existing alpha.60 adapter.

Usage: python3 tooling/build-domain-transaction-vendor.py /absolute/dlf/worktree
Pass worker-transport as the optional second argument for the B artifact.
Run pnpm package in that DLF worktree first. Native adapters are retained byte-for-byte.
"""
import gzip
import hashlib
import io
import json
from pathlib import Path
import sys
import subprocess
import tarfile

root = Path(__file__).resolve().parent.parent
source = Path(sys.argv[1]).resolve()
baseline = root / 'vendor/delightful-local-first-dbc452e-xstate-v6-jazz-alpha60.tgz'
exports = {
    'transactions/contracts': 'contracts/domain-transaction',
    'transactions/workflow': 'machines/workspaces/domain-transaction',
    'lifecycle/operation/contracts': 'contracts/owned-operation',
    'lifecycle/operation/workflow': 'machines/lifecycle/owned-operation'
}
profile = sys.argv[2] if len(sys.argv) > 2 else 'operations'
if profile not in ['operations', 'worker-transport']:
    raise SystemExit('Unknown lifecycle artifact profile')
if profile == 'worker-transport':
    exports.update({
        'worker/request/contracts': 'contracts/worker-request',
        'worker/request/workflow': 'machines/lifecycle/worker-request',
        'worker/channel/contracts': 'contracts/worker-channel',
        'worker/channel/workflow': 'machines/lifecycle/worker-channel',
        'worker/effect-drain/contracts': 'contracts/worker-effect-drain',
        'worker/effect-drain/workflow': 'machines/lifecycle/worker-effect-drain'
    })
modules = list(exports.values())
files = {}
with tarfile.open(baseline, 'r:gz') as archive:
    for member in archive:
        if member.isfile():
            files[member.name] = archive.extractfile(member).read()
for module in modules:
    for suffix in ['.js', '.d.ts', '.js.map', '.d.ts.map']:
        path = source / 'dist' / (module + suffix)
        if path.exists():
            files['package/dist/' + module + suffix] = path.read_bytes()
for module in modules:
    assert 'package/dist/' + module + '.js' in files
    assert 'package/dist/' + module + '.d.ts' in files
package = json.loads(files['package/package.json'])
# Keep baseline formatting so the existing pnpm recovery-view patch applies once.
for name, module in exports.items():
    package['exports']['./' + name] = {
        'types': './dist/' + module + '.d.ts',
        'default': './dist/' + module + '.js'
    }
files['package/package.json'] = (json.dumps(package, indent=2) + '\n').encode()
revision = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
artifact_name = f'delightful-local-first-worker-transport-{revision[:7]}-alpha60.tgz' if profile == 'worker-transport' else 'delightful-local-first-workflow-hardening-alpha60.tgz'
output = root / 'vendor' / artifact_name
with output.open('wb') as target:
    with gzip.GzipFile(fileobj=target, mode='wb', filename='', mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode='w') as archive:
            for name, content in sorted(files.items()):
                info = tarfile.TarInfo(name)
                info.size = len(content)
                info.mode = 0o644
                archive.addfile(info, io.BytesIO(content))
# Record the exact source snapshot, not an invented committed source revision.
digest = lambda data: hashlib.sha256(data).hexdigest()
source_files = ['src/lib/' + module + '.ts' for module in modules]
provenance = {
    'file': output.name,
    'sha256': digest(output.read_bytes()),
    'baseline': {'file': baseline.name, 'sha256': digest(baseline.read_bytes())},
    'dlfBase': '9d2b0f6ae10d6a19f4dfa3cf7d606edbe4554e50',
    'sourceFiles': {name: digest((source / name).read_bytes()) for name in source_files},
    'adaptation': 'Add only generic domain transaction, owned operation, scoped worker request/channel and effect-drain JS/declarations and public exports; retain all baseline modules and alpha.60 adapters unchanged. The existing pnpm recovery/view patch remains applied separately at installation.' if profile == 'worker-transport' else 'Add only generic domain transaction and owned operation JS/declarations and public exports; retain all baseline modules and alpha.60 adapters unchanged. The existing pnpm recovery/view patch remains applied separately at installation.',
    'xstate': '6.0.0-beta.1', 'jazz': '2.0.0-alpha.60'
}
if all(subprocess.check_output(['git', '-C', str(source), 'show', revision + ':' + name]) ==
       (source / name).read_bytes() for name in source_files):
    provenance['dlfSource'] = revision
provenance_name = 'worker-transport-provenance.json' if profile == 'worker-transport' else 'workflow-hardening-provenance.json'
(root / 'vendor' / provenance_name).write_text(json.dumps(provenance, indent='\t') + '\n')
print(output.name, provenance['sha256'])
