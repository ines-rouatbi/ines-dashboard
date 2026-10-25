"""Relais local vers le tunnel du service PC-FNO3D, en IPv4 seulement (deploiement sur le PC).

Pourquoi : sur ines-pc il n'y a pas de route IPv6 ; `wrangler dev` (workerd) essaie d'abord l'adresse
IPv6 de atom-origin.zelqane.com et reste bloque, ce qui fige tout le Worker local. En production
(Cloudflare) le probleme n'existe pas. Ce relais ne sert qu'au deploiement local :

    python dev/relais_ipv4.py                      # 127.0.0.1:8771 -> https://atom-origin.zelqane.com
    npx wrangler dev --local --port 8787 --var ORIGIN:http://127.0.0.1:8771

Il recopie la requete (methode, chemin, en-tetes utiles, corps) et la reponse. Origine injoignable :
503 JSON `service_asleep`, comme le Worker. Aucune cle n'est ajoutee ici (le Worker s'en charge).
"""
from __future__ import annotations

import http.client
import json
import socket
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ORIGINE = "atom-origin.zelqane.com"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8771
HOP = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer",
       "transfer-encoding", "upgrade", "host", "content-length", "accept-encoding"}

_getaddrinfo = socket.getaddrinfo


def _ipv4(host, port, family=0, type=0, proto=0, flags=0):   # noqa: A002
    return _getaddrinfo(host, port, socket.AF_INET, type, proto, flags)


socket.getaddrinfo = _ipv4


class Relais(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _relayer(self) -> None:
        n = int(self.headers.get("Content-Length") or 0)
        corps = self.rfile.read(n) if n else None
        entetes = {k: v for k, v in self.headers.items() if k.lower() not in HOP}
        entetes["Host"] = ORIGINE
        try:
            c = http.client.HTTPSConnection(ORIGINE, timeout=150)
            c.request(self.command, self.path, body=corps, headers=entetes)
            r = c.getresponse()
            data = r.read()
            statut = r.status
            hdrs = [(k, v) for k, v in r.getheaders() if k.lower() not in HOP | {"content-encoding"}]
            c.close()
            if statut in (502, 504) or 520 <= statut <= 530:
                raise ConnectionError(f"origine {statut}")
        except Exception as exc:                                   # noqa: BLE001
            data = json.dumps({"error": "service_asleep",
                               "message": "Le service PC-FNO3D est hors ligne (Colab endormi ou "
                                          "connecteur arrêté). Réessaie dans un instant.",
                               "detail": f"relais local : {exc}"}, ensure_ascii=False).encode()
            statut, hdrs = 503, [("Content-Type", "application/json; charset=utf-8")]
        self.send_response(statut)
        for k, v in hdrs:
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    do_GET = do_POST = do_PUT = do_DELETE = do_PATCH = do_HEAD = do_OPTIONS = _relayer

    def log_message(self, fmt, *args):
        sys.stderr.write("relais " + fmt % args + "\n")


if __name__ == "__main__":
    print(f"relais IPv4 : http://127.0.0.1:{PORT} -> https://{ORIGINE}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Relais).serve_forever()
