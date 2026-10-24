# OSS Scanner enrolment

This folder holds what Anthropic's [OSS Scanner](https://github.com/anthropics/oss-scanner) needs
to audit this repository: `Dockerfile` builds the project and runs its tests, and `threat_model.md`
tells the scanner where untrusted input enters and how we rate severity. Nothing here is used by
the tool itself.

To enrol (a core maintainer must open the pull request), add `projects/ai-tag-debugger/project.yaml`
to the oss-scanner repository:

```yaml
repo: https://github.com/analitikisler/ai-tag-debugger#main
primary_contact: <a security alias; the address is published>
homepage: https://github.com/analitikisler/ai-tag-debugger
dockerfile: .oss-scanner/Dockerfile
threat_model: .oss-scanner/threat_model.md
```

Before opening it, run `tools/validate.py` and `tools/check ai-tag-debugger` from a clone of that
repository: the second builds this Dockerfile the way the scanner does and opens a shell in the
image with no network, where `npm test` should pass. To pause reports set `disabled: true`; to
withdraw, remove the project folder.
