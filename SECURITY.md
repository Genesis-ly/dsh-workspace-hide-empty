# Security policy

## Supported versions

Only the latest release of `dsh-workspace-hide-empty` is supported with security updates.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting: open the **Security** tab of this repository
and choose **Report a vulnerability**. Do not open a public issue for a security problem.

Include the package version, DSH version, Windows version, reproduction steps, and the impact you
observed. You will get a response as soon as the report is reviewed.

## Scope

This plugin runs inside the local DSH process with your user privileges. Keep credentials out of
issues and logs: use the documented local secret file or environment variables, and treat any token
or webhook URL pasted into an issue as compromised.

## Out of scope

- Vulnerabilities in DSH itself — report them to the DSH project.
- Vulnerabilities in third-party plugins this package integrates with.
