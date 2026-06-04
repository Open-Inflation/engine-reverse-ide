name: {{ yaml_value(feature_request.name) }}
description: {{ yaml_value(feature_request.description) }}
title: {{ yaml_value(feature_request.title) }}
labels: {{ yaml_value(feature_request.labels) }}
assignees: [{{ yaml_value(assignee) }}]

body:
  - type: markdown
    attributes:
      value: |
        **Thank you for helping us grow!**  
        Please fill out the fields below; mock-ups/screenshots are welcome.

  - type: input
    id: what
    attributes:
      label: What do you want to achieve?
      placeholder: "e.g. Support dark mode in the web UI"
    validations:
      required: true

  - type: textarea
    id: how
    attributes:
      label: How should it look/work?
      description: |
        Describe the desired behaviour. Plain text is mandatory; you can drag-and-drop images below if helpful.
      render: markdown
    validations:
      required: true

  - type: textarea
    id: context
    attributes:
      label: Additional context / attachments
      description: Drag & drop any images or diagrams here.
