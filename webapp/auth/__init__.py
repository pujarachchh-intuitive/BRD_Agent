"""Authentication: registration, login, session cookies, and the current-user/admin dependencies.

Kept as its own subpackage so future ownership/RBAC work has a single place to extend, without
touching the existing BRD generation routes in webapp/server.py and webapp/service.py.
"""
