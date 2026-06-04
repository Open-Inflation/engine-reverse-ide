name: {{ yaml_value(documentation_issue.name) }}
description: {{ yaml_value(documentation_issue.description) }}
title: {{ yaml_value(documentation_issue.title) }}
labels: {{ yaml_value(documentation_issue.labels) }}
assignees: [{{ yaml_value(assignee) }}]

body:
  - type: markdown
    attributes:
      value: |
        **Help us keep the docs sharp!**

  - type: input
    id: url
    attributes:
      label: Link to the problematic page
      placeholder: "https://example.com/docs/..."
    validations:
      required: true

  - type: textarea
    id: problem
    attributes:
      label: What’s broken or unclear?
      render: markdown
    validations:
      required: true

  - type: textarea
    id: screenshots
    attributes:
      label: Screenshots (optional)
      description: Drag & drop images if they help illustrate the issue.
