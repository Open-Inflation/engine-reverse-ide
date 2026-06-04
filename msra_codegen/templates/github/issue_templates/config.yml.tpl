blank_issues_enabled: {{ "true" if blank_issues_enabled else "false" }}

contact_links:
{% for link in contact_links %}
  - name: {{ yaml_value(link.name) }}
    url: {{ yaml_value(link.url) }}
    about: {{ yaml_value(link.about) }}
{% endfor %}
