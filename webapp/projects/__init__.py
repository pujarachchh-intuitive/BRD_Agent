"""Project ownership: the `projects` table, and the CRUD + ownership-check endpoints/helpers
built on it. Other modules (webapp/service.py) call into `service.get_owned_project_or_404` /
`service.create_project_row` to authorize and tag BRD generation with a project."""
