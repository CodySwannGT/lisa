# Add ast-grep to Lisa

## Original Request

Add ast-grep to lisa like that. it should follow our inheritance pattern that lisa uses for eslint and the rules should run via claude hooks and pre-commit (similar to claude-code-safety-net) but also as a new quality check in quality.yml. It's important that it creates an empty config or whatever for the implementing projects to be able to extend the base rules - again just like we did with eslint
