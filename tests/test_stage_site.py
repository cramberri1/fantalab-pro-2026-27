import base64
import hashlib
import json
from pathlib import Path
import re
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))

from stage_site import stage_site, write_worker
from update_data import SNAPSHOT


class StageSiteTests(unittest.TestCase):
    def test_staged_worker_integrity_tracks_the_public_shell(self):
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / 'site'
            stage_site(destination, SNAPSHOT)
            index = (destination / 'index.html').read_text(encoding='utf-8')
            worker = (destination / 'sw.js').read_text(encoding='utf-8')
            assets = json.loads(re.search(r'^const SHELL = (.*);$', worker, re.MULTILINE)[1])
            manifest = json.loads((destination / 'manifest.webmanifest').read_text(encoding='utf-8'))

            self.assertIn('<meta name="fantalab-offline" content="enabled">', index)
            self.assertEqual(manifest['scope'], './')
            self.assertEqual(manifest['start_url'], './')
            paths = [entry['path'] for entry in assets]
            self.assertTrue({'index.html', 'js/app.js', 'styles.css', *(icon['src'] for icon in manifest['icons'])} <= set(paths))
            self.assertFalse(any(path.startswith('data/') for path in paths))
            for entry in assets:
                raw = (destination / entry['path']).read_bytes()
                expected = 'sha256-' + base64.b64encode(hashlib.sha256(raw).digest()).decode('ascii')
                self.assertEqual(entry['integrity'], expected)

            staged_snapshot = destination / 'data' / SNAPSHOT.name
            with staged_snapshot.open('ab') as snapshot:
                snapshot.write(b'\n')
            write_worker(destination, paths)
            self.assertEqual((destination / 'sw.js').read_text(encoding='utf-8'), worker)

            with (destination / 'styles.css').open('ab') as stylesheet:
                stylesheet.write(b'\n')
            write_worker(destination, paths)
            updated = (destination / 'sw.js').read_text(encoding='utf-8')
            self.assertNotEqual(worker.splitlines()[0], updated.splitlines()[0])
