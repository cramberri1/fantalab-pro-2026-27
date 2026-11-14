"""Copy the public application and its normalized data to a fresh directory."""

import argparse
import base64
import hashlib
import json
from pathlib import Path
import shutil

from update_data import ROOT, SNAPSHOT, decode, validate


WEB_FOLDERS = {
    'assets': {'.avif', '.ico', '.jpg', '.png', '.svg', '.webp', '.woff', '.woff2'},
    'js': {'.js', '.mjs'},
}


def copy_file(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)


def write_worker(destination, shell_files):
    template = (ROOT / 'sw.js').read_text(encoding='utf-8')
    shell = []
    for path in sorted(shell_files):
        digest = hashlib.sha256((destination / path).read_bytes()).digest()
        integrity = 'sha256-' + base64.b64encode(digest).decode('ascii')
        shell.append({'path': path, 'integrity': integrity})
    encoded_shell = json.dumps(shell, ensure_ascii=True, separators=(',', ':'))
    revision = hashlib.sha256((template + encoded_shell).encode('utf-8')).hexdigest()
    worker = template.replace('const RELEASE = null;', f'const RELEASE = "{revision}";', 1)
    worker = worker.replace('const SHELL = [];', f'const SHELL = {encoded_shell};', 1)
    (destination / 'sw.js').write_text(worker, encoding='utf-8')


def stage_site(destination, snapshot):
    validate(decode(snapshot.read_bytes()))
    destination.mkdir(parents=True)
    shell_files = ['index.html', 'styles.css', 'manifest.webmanifest']
    for name in (*shell_files, 'data/demo.json'):
        copy_file(ROOT / name, destination / name)
    index = destination / 'index.html'
    html = index.read_text(encoding='utf-8')
    marker = '<meta name="fantalab-offline" content="disabled">'
    if marker not in html:
        raise ValueError('Manca il metadato di attivazione PWA.')
    index.write_text(html.replace(marker, '<meta name="fantalab-offline" content="enabled">', 1), encoding='utf-8')
    if not (ROOT / 'js' / 'app.js').is_file():
        raise FileNotFoundError('Manca js/app.js.')
    for folder, extensions in WEB_FOLDERS.items():
        for source in (ROOT / folder).rglob('*'):
            if source.is_file() and not source.is_symlink() and source.suffix.lower() in extensions:
                path = source.relative_to(ROOT)
                copy_file(source, destination / path)
                shell_files.append(path.as_posix())
    for name in ('docs/FONTI.md', 'docs/ANALISI.md', 'data/serie-a-2025-26.json'):
        if (ROOT / name).is_file():
            copy_file(ROOT / name, destination / name)
    copy_file(snapshot, destination / 'data' / SNAPSHOT.name)
    write_worker(destination, shell_files)
    (destination / '.nojekyll').touch()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination', type=Path)
    parser.add_argument('--snapshot', type=Path, default=SNAPSHOT)
    args = parser.parse_args()
    stage_site(args.destination, args.snapshot)
