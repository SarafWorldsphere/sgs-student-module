"""Read-only checks through the real public proxy; no login or OTP requests."""
import argparse
import json
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import urlopen


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--origin', required=True, help='For example https://sgs-test.swais.in')
    parser.add_argument('--identity', help='Optional known student email/phone for this school')
    args = parser.parse_args()
    origin = args.origin.rstrip('/')
    parts = urlsplit(origin)
    if parts.scheme not in ('http', 'https') or not parts.netloc or parts.path or parts.query or parts.fragment:
        parser.error('--origin must contain only scheme and host (plus optional port)')
    paths = ['/health', '/openapi.json', '/public/tenant-config', '/health/db']
    if args.identity:
        paths.append('/students/current?' + urlencode({'email': args.identity}))
    for path in paths:
        label = path.split('?')[0]
        try:
            with urlopen(origin + '/api/student' + path, timeout=20) as response:
                data = json.load(response)
                if label == '/openapi.json':
                    if not {'/students/current', '/notifications', '/timetable'}.issubset(data.get('paths', {})):
                        raise ValueError('The proxy did not reach the expected student API')
                elif label == '/students/current':
                    student = data.get('student', {})
                    if not student.get('student_id') or not student.get('class_id'):
                        raise ValueError('Student response lacks a student or class ID')
                elif label == '/public/tenant-config' and not data.get('tenantId'):
                    raise ValueError('No resolved school in tenant-config response')
                print(f'PASS {label}: HTTP {response.status}')
        except (HTTPError, URLError, ValueError) as error:
            code = getattr(error, 'code', None)
            print(f'FAIL {label}: ' + (f'HTTP {code}' if code else type(error).__name__), file=sys.stderr)
            if code == 404:
                print('Check the student proxy target and host-to-school registration.', file=sys.stderr)
            elif code in (500, 503):
                print('Check student backend logs, DB settings, role grants and tenant context.', file=sys.stderr)
            return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
