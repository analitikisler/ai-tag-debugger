# Notes for Claude

## Commits and pull requests

The owner wants every commit on `main` to be authored by them and marked Verified on GitHub.

- Never push to `main`, and never force-push it. Deliver every change as a pull request; the owner merges it with **Squash and merge**, so GitHub signs the commit on `main`.
- Commit as the owner. Before your first commit, run:
  `git config user.name "Bahadır"` and `git config user.email "bahadirolez@gmail.com"`
- Don't add `Co-Authored-By: Claude` or other Claude trailers to commit messages.
- Don't create branches on GitHub other than the one your pull request uses.
