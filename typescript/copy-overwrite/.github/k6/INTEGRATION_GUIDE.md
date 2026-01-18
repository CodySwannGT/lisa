# K6 Load Testing Integration Guide

This guide provides patterns and best practices for integrating the k6 load testing workflow into your deployment pipelines.

## Table of Contents

1. [Integration Patterns](#integration-patterns)
2. [Multi-Environment Testing](#multi-environment-testing)
3. [Scheduled Testing](#scheduled-testing)
4. [Cost Optimization](#cost-optimization)
5. [Troubleshooting](#troubleshooting)
6. [Best Practices](#best-practices)

## Integration Patterns

### 1. Post-Deployment Smoke Testing

The most common pattern is running a smoke test immediately after deployment to verify basic functionality.

```yaml
jobs:
  deploy:
    # Your deployment job
    
  smoke-test:
    needs: deploy
    uses: ./.github/workflows/k6-load-test.yml
    with:
      environment: ${{ inputs.environment }}
      test_scenario: smoke
      base_url: ${{ needs.deploy.outputs.url }}
      fail_on_threshold: true  # Fail fast for smoke tests
```

**When to use:**
- After every deployment
- As a deployment validation gate
- For rapid feedback on deployment health

### 2. Progressive Load Testing

Run increasingly intensive tests as you move through environments.

```yaml
jobs:
  test-suite:
    strategy:
      matrix:
        include:
          - env: development
            scenario: smoke
            fail_on_threshold: false
          - env: staging
            scenario: load
            fail_on_threshold: true
          - env: production
            scenario: smoke
            fail_on_threshold: true
    
    uses: ./.github/workflows/k6-load-test.yml
    with:
      environment: ${{ matrix.env }}
      test_scenario: ${{ matrix.scenario }}
      base_url: ${{ vars[format('{0}_URL', matrix.env)] }}
      fail_on_threshold: ${{ matrix.fail_on_threshold }}
```

**When to use:**
- Multi-stage deployment pipelines
- When production can only handle limited testing
- For risk-based testing strategies

### 3. Gated Production Deployment

Use performance tests as a quality gate before production deployment.

```yaml
jobs:
  staging-deploy:
    # Deploy to staging
    
  performance-gate:
    needs: staging-deploy
    uses: ./.github/workflows/k6-load-test.yml
    with:
      environment: staging
      test_scenario: load
      base_url: ${{ needs.staging-deploy.outputs.url }}
      fail_on_threshold: true
      
  production-deploy:
    needs: performance-gate
    if: success()
    # Deploy to production only if performance tests pass
```

**When to use:**
- High-traffic applications
- When performance SLAs are critical
- For applications with strict performance requirements

### 4. Rollback on Performance Degradation

Automatically rollback deployments that fail performance tests.

```yaml
jobs:
  deploy:
    outputs:
      previous_version: ${{ steps.get_version.outputs.previous }}
      
  performance-test:
    needs: deploy
    uses: ./.github/workflows/k6-load-test.yml
    with:
      environment: ${{ inputs.environment }}
      test_scenario: load
      base_url: ${{ needs.deploy.outputs.url }}
      
  rollback:
    needs: [deploy, performance-test]
    if: failure() && needs.performance-test.result == 'failure'
    runs-on: ubuntu-latest
    steps:
      - name: Rollback deployment
        run: |
          # Your rollback logic here
          echo "Rolling back to version ${{ needs.deploy.outputs.previous_version }}"
```

## Multi-Environment Testing

### Strategy 1: Environment-Specific Configurations

Use different test configurations for each environment:

```yaml
with:
  test_scenario: ${{ inputs.environment == 'production' && 'smoke' || 'load' }}
  virtual_users: ${{ inputs.environment == 'production' && 5 || 50 }}
  test_duration: ${{ inputs.environment == 'production' && '1m' || '5m' }}
```

### Strategy 2: Custom Threshold Files

Create environment-specific threshold configurations:

```yaml
with:
  thresholds_config: .github/k6/thresholds/${{ inputs.environment }}.json
```

### Strategy 3: Progressive Testing

| Environment | Test Type | Duration | VUs | Purpose |
|------------|-----------|----------|-----|---------|
| Development | Smoke | 1m | 1 | Basic validation |
| Staging | Load | 10m | 50 | Full performance test |
| Production | Smoke | 2m | 5 | Health verification |
| Production | Soak | 1h | 10 | Weekend/monthly test |

## Scheduled Testing

### Daily Performance Baseline

Run performance tests on a schedule to detect gradual degradation:

```yaml
name: Scheduled Performance Tests

on:
  schedule:
    - cron: '0 2 * * *'  # 2 AM daily
  workflow_dispatch:

jobs:
  baseline-test:
    uses: ./.github/workflows/k6-load-test.yml
    with:
      environment: production
      test_scenario: load
      base_url: ${{ vars.PRODUCTION_URL }}
      virtual_users: 20  # Lower than peak for baseline
      fail_on_threshold: false  # Don't fail, just report
```

### Weekly Stress Testing

Run intensive tests during low-traffic periods:

```yaml
on:
  schedule:
    - cron: '0 3 * * 0'  # 3 AM Sunday

jobs:
  stress-test:
    uses: ./.github/workflows/k6-load-test.yml
    with:
      environment: staging
      test_scenario: stress
      base_url: ${{ vars.STAGING_URL }}
```

## Cost Optimization

### 1. Smart Test Selection

Minimize GitHub Actions minutes by running appropriate tests:

```yaml
# Only run expensive tests on main branch
if: github.ref == 'refs/heads/main'
with:
  test_scenario: ${{ github.event_name == 'pull_request' && 'smoke' || 'load' }}
```

### 2. Conditional Testing

Skip tests for non-critical changes:

```yaml
# Skip tests for documentation changes
if: |
  !contains(github.event.head_commit.message, '[skip-tests]') &&
  !contains(fromJson('["docs", "README", "LICENSE"]'), github.event.head_commit.modified[0])
```

### 3. Resource Optimization

- **Development**: Smoke tests only (1 minute)
- **Pull Requests**: Smoke tests (1 minute)
- **Staging**: Full load tests (10 minutes)
- **Production**: Smoke tests, with weekly load tests
- **Use k6 Cloud**: For tests requiring high concurrency

### 4. Cost Calculation

| Test Type | Duration | Frequency | Monthly Minutes |
|-----------|----------|-----------|-----------------|
| Smoke | 2m | Every deploy (~100/mo) | 200 |
| Load | 10m | Daily staging | 300 |
| Stress | 30m | Weekly | 120 |
| **Total** | | | **620 minutes** |

## Troubleshooting

### Common Issues and Solutions

#### 1. Base URL Not Accessible

**Error**: `Base URL https://example.com is not accessible. Status: 404`

**Solutions**:
- Ensure deployment is complete before testing
- Add a health check wait step:
  ```yaml
  - name: Wait for deployment
    run: |
      for i in {1..30}; do
        if curl -s -o /dev/null -w "%{http_code}" ${{ inputs.base_url }}/health | grep -q "200"; then
          echo "Application is ready"
          break
        fi
        echo "Waiting for application to be ready..."
        sleep 10
      done
  ```

#### 2. Authentication Failures

**Error**: `GET /api/items: status is 401`

**Solutions**:
- Provide authentication headers via secrets:
  ```yaml
  secrets:
    CUSTOM_HEADERS: |
      {
        "Authorization": "Bearer ${{ secrets.API_TOKEN }}"
      }
  ```

#### 3. Threshold Failures

**Error**: `✗ http_req_duration..........: avg=1523.45ms p(95)=2103.22ms`

**Solutions**:
- Review if thresholds are realistic for the environment
- Use environment-specific thresholds
- Consider gradual threshold tightening

#### 4. High Error Rates

**Error**: `✗ http_req_failed...........: 12.50% ✓ 250 ✗ 2250`

**Solutions**:
- Check rate limiting on the target server
- Reduce virtual users or add ramping
- Verify the application can handle the load

#### 5. Artifacts Too Large

**Error**: `Warning: Artifact k6-results-* is 103MB, exceeding the 100MB limit`

**Solutions**:
- Reduce test duration
- Limit output formats (remove CSV if not needed)
- Compress results before upload

## Best Practices

### 1. Start Small
- Begin with smoke tests
- Gradually add more complex scenarios
- Build confidence before intensive testing

### 2. Environment Isolation
- Never run stress tests on production
- Use staging for intensive testing
- Keep production tests minimal

### 3. Meaningful Thresholds
- Base thresholds on actual SLAs
- Start with relaxed thresholds
- Tighten gradually based on data

### 4. Test Data Management
- Use test accounts for authenticated endpoints
- Clean up test data after runs
- Avoid testing with production data

### 5. Monitoring Integration
- Compare k6 results with APM data
- Correlate test times with system metrics
- Use results to set alerting thresholds

### 6. Version Control
- Track test scripts in the repository
- Version threshold configurations
- Document changes to test scenarios

### 7. Team Communication
- Share test results in PR comments
- Document performance requirements
- Make thresholds visible to all stakeholders

## Next Steps

1. Start with smoke tests in your deployment pipeline
2. Establish baseline metrics from initial runs
3. Gradually add more scenarios based on needs
4. Customize thresholds based on your SLAs
5. Integrate results with your monitoring stack