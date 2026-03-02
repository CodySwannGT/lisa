# K6 Test Scenario Selection Guide

This guide helps you choose the appropriate k6 test scenario for your needs.

## Quick Decision Tree

```
Is this a post-deployment validation?
├─ YES → SMOKE TEST
└─ NO → Continue...
   │
   Is this for regular performance validation?
   ├─ YES → LOAD TEST
   └─ NO → Continue...
      │
      Do you need to find breaking points?
      ├─ YES → STRESS TEST
      └─ NO → Continue...
         │
         Is the concern about sudden traffic spikes?
         ├─ YES → SPIKE TEST
         └─ NO → Continue...
            │
            Do you need to test for memory leaks or degradation?
            ├─ YES → SOAK TEST
            └─ NO → SMOKE TEST (default)
```

## Scenario Comparison

| Scenario | Duration | VUs | Use Case | Frequency |
|----------|----------|-----|----------|-----------|
| **Smoke** | 1-2 min | 1-5 | Basic functionality check | Every deployment |
| **Load** | 5-10 min | 10-100 | Normal traffic simulation | Daily/Weekly |
| **Stress** | 15-30 min | 100-500 | Find breaking points | Monthly/Before major releases |
| **Spike** | 5-10 min | 5→100→5 | Traffic surge handling | Before marketing campaigns |
| **Soak** | 30+ min | 10-50 | Long-term stability | Weekly/Monthly |

## Detailed Scenario Guidelines

### Smoke Test
**Choose when:**
- ✅ After every deployment
- ✅ Quick health check needed
- ✅ CI/CD pipeline validation
- ✅ Pre-production verification

**Avoid when:**
- ❌ Need performance metrics
- ❌ Testing scalability
- ❌ Looking for edge cases

**Configuration:**
```yaml
test_scenario: smoke
test_duration: 1m
virtual_users: 1
fail_on_threshold: true
```

### Load Test
**Choose when:**
- ✅ Measuring normal performance
- ✅ Establishing baselines
- ✅ SLA verification
- ✅ Capacity planning

**Avoid when:**
- ❌ Just need health check
- ❌ System is unstable
- ❌ During peak traffic

**Configuration:**
```yaml
test_scenario: load
test_duration: 10m
virtual_users: 50
fail_on_threshold: true
```

### Stress Test
**Choose when:**
- ✅ Finding system limits
- ✅ Capacity planning
- ✅ Before scaling decisions
- ✅ Architecture validation

**Avoid when:**
- ❌ In production environment
- ❌ System has known issues
- ❌ Limited test window

**Configuration:**
```yaml
test_scenario: stress
test_duration: 30m
fail_on_threshold: false  # Expect some failures
upload_results: true     # For detailed analysis
```

### Spike Test
**Choose when:**
- ✅ Before marketing campaigns
- ✅ Flash sale preparation
- ✅ Testing auto-scaling
- ✅ Validating circuit breakers

**Avoid when:**
- ❌ System doesn't auto-scale
- ❌ Traffic is always steady
- ❌ No surge protection needed

**Configuration:**
```yaml
test_scenario: spike
virtual_users: 100  # Peak spike size
fail_on_threshold: false
```

### Soak Test
**Choose when:**
- ✅ Detecting memory leaks
- ✅ Finding degradation issues
- ✅ Validating stability
- ✅ Before major releases

**Avoid when:**
- ❌ Quick feedback needed
- ❌ Limited test window
- ❌ System changes frequently

**Configuration:**
```yaml
test_scenario: soak
test_duration: 2h  # Or longer
virtual_users: 20
fail_on_threshold: false
```

## Environment-Specific Recommendations

### Development Environment
```yaml
Primary: smoke
Secondary: load (reduced VUs)
Frequency: Every commit
Duration: 1-2 minutes max
```

### Staging Environment
```yaml
Primary: load
Secondary: stress, spike
Frequency: Daily load, weekly stress
Duration: 5-30 minutes
```

### Production Environment
```yaml
Primary: smoke
Secondary: load (off-peak only)
Frequency: Every deployment
Duration: 1-5 minutes max
Special: Monthly soak during maintenance windows
```

## Custom Scenario Combinations

### Pre-Release Validation
```yaml
1. smoke → Verify basic functionality
2. load → Check normal performance
3. spike → Test surge handling
4. stress → Find limits (staging only)
```

### Performance Regression Testing
```yaml
1. load → Baseline measurement
2. Deploy changes
3. load → Compare results
4. Decision based on delta
```

### Incident Response
```yaml
1. smoke → Quick health check
2. load (reduced) → Gradual increase
3. Monitor and adjust
```

## Threshold Recommendations by Scenario

### Smoke Test Thresholds
- `http_req_failed`: < 1%
- `http_req_duration`: p(95) < 500ms
- `checks`: > 95%

### Load Test Thresholds
- `http_req_failed`: < 5%
- `http_req_duration`: p(95) < 1000ms
- `checks`: > 90%

### Stress Test Thresholds
- `http_req_failed`: < 10%
- `http_req_duration`: p(95) < 3000ms
- `checks`: > 80%

### Spike Test Thresholds
- `http_req_failed`: < 15%
- `http_req_duration`: p(95) < 5000ms
- Recovery time: < 2 minutes

### Soak Test Thresholds
- `http_req_failed`: < 2%
- `http_req_duration`: Stable (no degradation)
- Memory usage: Stable
- `checks`: > 95%

## Anti-Patterns to Avoid

1. **Running stress tests in production**
   - Use staging or dedicated load test environment

2. **Using same thresholds for all scenarios**
   - Each scenario has different expectations

3. **Running long tests in CI/CD**
   - Keep CI/CD tests under 5 minutes

4. **Testing without baseline**
   - Always establish baseline metrics first

5. **Ignoring environment differences**
   - Adjust expectations per environment

## Progression Strategy

Start simple and build up:

1. **Week 1-2**: Smoke tests only
2. **Week 3-4**: Add load tests
3. **Month 2**: Introduce spike tests
4. **Month 3**: Add stress tests (staging)
5. **Ongoing**: Monthly soak tests

## Quick Reference

```bash
# Quick smoke test
test_scenario: smoke

# Standard performance test
test_scenario: load

# Find breaking points (staging only)
test_scenario: stress

# Test traffic spikes
test_scenario: spike

# Long-term stability
test_scenario: soak
```