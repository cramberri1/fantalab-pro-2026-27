"""Copy the public application and its normalized data to a fresh directory."""

import argparse
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


def stage_site(destination, snapshot):
    validate(decode(snapshot.read_bytes()))
    destination.mkdir(parents=True)
    for name in ('index.html', 'styles.css', 'data/demo.json'):
        copy_file(ROOT / name, destination / name)
    if not (ROOT / 'js' / 'app.js').is_file():
        raise FileNotFoundError('Manca js/app.js.')
    for folder, extensions in WEB_FOLDERS.items():
        for source in (ROOT / folder).rglob('*'):
            if source.is_file() and not source.is_symlink() and source.suffix.lower() in extensions:
                copy_file(source, destination / source.relative_to(ROOT))
    if (ROOT / 'docs' / 'FONTI.md').is_file():
        copy_file(ROOT / 'docs' / 'FONTI.md', destination / 'docs' / 'FONTI.md')
    copy_file(snapshot, destination / 'data' / SNAPSHOT.name)
    (destination / '.nojekyll').touch()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination', type=Path)
    parser.add_argument('--snapshot', type=Path, default=SNAPSHOT)
    args = parser.parse_args()
    stage_site(args.destination, args.snapshot)
