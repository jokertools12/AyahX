"""Offline host lock from root's post-K2 approved provider inventory, no DB/network.

Inventory rows: {recitationSlug, allowedHosts}; export by root after K2 approval.
No host is inferred from URL or added here. Manifest samples remain untouched.
"""
import argparse
import json
import os
from pathlib import Path
from urllib.parse import urlparse

from execute_qud_t7 import checked_json, locked_manifest, private_path
from lib.t7_offset_execution import canonical, digest, provider_host_allowed, validate_provider_hosts


def build_host_snapshot(manifest, inventory):
    rows = inventory if isinstance(inventory, list) else inventory['records']
    providers = {}
    for row in rows:
        slug, hosts = row['recitationSlug'], row['allowedHosts']
        if slug in providers or not validate_provider_hosts(hosts):
            raise ValueError('PROVIDER_INVENTORY_DUPLICATE_OR_INVALID_ALLOWLIST')
        providers[slug] = sorted(set(hosts))
    output = {}
    for slug, record in manifest['results'].items():
        if slug not in providers:
            raise ValueError('LOCKED_RECITATION_PROVIDER_HOSTS_MISSING')
        output[slug] = providers[slug]
        for sample in record['samples']:
            host = urlparse(sample['original_public_url']).hostname
            if not host or not provider_host_allowed(host, output[slug]):
                raise ValueError('LOCKED_ORIGINAL_SOURCE_NOT_ALLOWED_BY_APPROVED_PROVIDER')
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for field in ('manifest', 'manifest-sha', 'provider-inventory', 'provider-inventory-sha', 'out'):
        parser.add_argument('--' + field, required=True)
    args = parser.parse_args()
    manifest = locked_manifest(Path(args.manifest), args.manifest_sha)
    inventory = checked_json(Path(args.provider_inventory), args.provider_inventory_sha)
    hosts = build_host_snapshot(manifest, inventory)
    payload = canonical(hosts) + b'\n'
    output = private_path(Path(args.out))
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        if output.read_bytes() != payload:
            raise ValueError('HOST_LOCK_ALREADY_EXISTS_AND_DIFFERS_PRESERVE_PREVIOUS')
    else:
        with output.open('xb') as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
    print(json.dumps({'snapshot_only': True, 'network_requests': 0, 'database_writes': 0,
                      'recitations': len(hosts), 'snapshot_sha256': digest(payload),
                      'manifest_sha256': args.manifest_sha,
                      'inventory_sha256': args.provider_inventory_sha,
                      'execution_authorized': False}))


if __name__ == '__main__':
    main()
