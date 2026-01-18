# K6 Load Testing Workflow

## Overview

The `k6-load-test.yml` is a reusable GitHub Actions workflow designed to run k6 performance tests as part of your CI/CD pipeline. It supports multiple test scenarios, flexible configuration, and both local and cloud execution.

## Quick Start

```yaml
name: Deploy and Test
on:
  push:
    branches: [main]

jobs:
  deploy:
    # Your deployment steps
    
  performance-test:
    needs: deploy
    uses: ./.github/workflows/k6-load-test.yml
    with:
      environment: production
      test_scenario: smoke
      base_url: https://api.example.com
    secrets: inherit
```

## Workflow Inputs

| Input | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `environment` | string | Yes | - | Target environment (staging, production) |
| `test_scenario` | string | No | smoke | Test type: smoke, load, stress, spike, soak |
| `base_url` | string | Yes | - | Base URL of application to test |
| `k6_version` | string | No | latest | k6 version to use |
| `test_duration` | string | No | - | Override test duration (e.g., 5m, 1h) |
| `virtual_users` | number | No | - | Override number of virtual users |
| `thresholds_config` | string | No | - | Path to custom thresholds JSON |
| `test_script` | string | No | .github/k6/scripts/default-test.js | Path to k6 test script |
| `fail_on_threshold` | boolean | No | true | Fail workflow if thresholds not met |
| `upload_results` | boolean | No | true | Upload test results as artifacts |
| `cloud_run` | boolean | No | false | Run tests on k6 Cloud |

## Workflow Outputs

| Output | Description |
|--------|-------------|
| `test_passed` | Whether the test passed all thresholds (true/false) |
| `results_url` | URL to test results artifact |
| `summary` | Test execution summary |

## Workflow Secrets

| Secret | Required | Description |
|--------|----------|-------------|
| `K6_CLOUD_TOKEN` | No | k6 Cloud API token for cloud runs |
| `CUSTOM_HEADERS` | No | Custom headers for authenticated endpoints (JSON) |

## Test Scenarios

### Available Scenarios

- **smoke**: Quick validation (1 min, 1 VU)
- **load**: Normal traffic (9 min, 10 VUs)
- **stress**: Find breaking points (33 min, up to 200 VUs)
- **spike**: Sudden traffic changes (8 min, 5→100→5 VUs)
- **soak**: Extended duration (30+ min, 10 VUs)

### Selecting a Scenario

See the [Scenario Selection Guide](../k6/SCENARIO_SELECTION_GUIDE.md) for detailed guidance.

## Authentication

For testing protected endpoints:

```yaml
uses: ./.github/workflows/k6-load-test.yml
with:
  base_url: https://api.example.com
secrets:
  CUSTOM_HEADERS: |
    {
      "Authorization": "Bearer ${{ secrets.API_TOKEN }}",
      "X-API-Key": "${{ secrets.API_KEY }}"
    }
```

## Custom Test Scripts

Use your own test script:

```yaml
with:
  test_script: .github/k6/scripts/my-custom-test.js
```

## Custom Thresholds

Use environment-specific thresholds:

```yaml
with:
  thresholds_config: .github/k6/thresholds/production.json
```

## k6 Cloud Integration

For high-concurrency tests:

```yaml
uses: ./.github/workflows/k6-load-test.yml
with:
  cloud_run: true
secrets:
  K6_CLOUD_TOKEN: ${{ secrets.K6_CLOUD_TOKEN }}
```

## Artifacts

Test results are automatically uploaded as artifacts including:
- JSON results (`results.json`)
- CSV results (`results.csv`)
- HTML report (`report.html`)
- Scenario-specific summaries

Artifacts are retained for 30 days.

## Error Handling

The workflow handles various error scenarios:
- Base URL not accessible
- Test script not found
- Threshold failures
- k6 installation issues

See the [Troubleshooting Guide](../k6/INTEGRATION_GUIDE.md#troubleshooting) for solutions.

## Integration Patterns

For comprehensive integration examples, see the [Integration Guide](../k6/INTEGRATION_GUIDE.md).

### Integration with Release and Deployment Workflows

The k6 load testing workflow is designed to integrate seamlessly with your release and deployment processes. Here's the recommended pattern:

```yaml
# deploy.yml.example - Complete release and deployment with load testing
name: 🚀 Release and Deploy

on:
  push:
    branches: [main, staging, dev]

jobs:
  # Step 1: Create a release
  release:
    uses: ./.github/workflows/release.yml
    with:
      environment: ${{ github.ref_name }}
      # ... other inputs
    
  # Step 2: Deploy to your infrastructure
  deploy:
    needs: release
    runs-on: ubuntu-latest
    outputs:
      environment_url: ${{ steps.deploy.outputs.environment_url }}
    steps:
      # Your deployment logic here
      
  # Step 3: Run load tests (staging only)
  load_testing:
    needs: [release, deploy]
    if: |
      needs.deploy.result == 'success' && 
      github.ref_name == 'staging'
    uses: ./.github/workflows/load-test.yml
    with:
      environment: staging
      test_scenario: smoke
      base_url: ${{ needs.deploy.outputs.environment_url }}
      fail_on_threshold: false  # Don't fail the deployment
    secrets: inherit
```

This pattern ensures:
- Releases are created first with proper versioning
- Deployments happen after successful releases
- Load tests run automatically for staging deployments
- Production deployments skip load testing (run manually if needed)

## File Structure

```
.github/
├── workflows/
│   └── k6-load-test.yml      # This workflow
└── k6/
    ├── scripts/              # Test scripts
    ├── scenarios/            # Scenario configs
    ├── thresholds/           # Threshold configs
    └── examples/             # Usage examples
```

## Workflow Steps

1. **Checkout**: Get repository code
2. **Setup k6**: Install specified k6 version
3. **Prepare Environment**: Set up test variables
4. **Run Test**: Execute k6 with parameters
5. **Generate Summary**: Create test report
6. **Upload Results**: Store artifacts
7. **Comment on PR**: Add results to PR (if applicable)

## Best Practices

1. Start with smoke tests
2. Use appropriate scenarios per environment
3. Set realistic thresholds
4. Monitor resource usage during tests
5. Review results regularly
6. Update tests as application evolves

## Support

- [k6 Documentation](https://k6.io/docs/)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- Project-specific guides in `.github/k6/`