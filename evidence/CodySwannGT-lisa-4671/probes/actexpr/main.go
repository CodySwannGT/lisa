// Evaluates the postgres/mysql service image strings of quality-rails.yml with
// nektos/act's GitHub-expression interpreter (pkg/exprparser, act v0.2.97) for
// the CodySwannGT/lisa#4671 AC-1..AC-4 inputs. act is an independent
// re-implementation of GitHub's evaluator, NOT GitHub's own service.
//
// Usage: go run . <workflow.yml>
package main

import (
	"fmt"
	"os"
	"regexp"
	"sort"

	"github.com/nektos/act/pkg/exprparser"
	"gopkg.in/yaml.v3"
)

type wf struct {
	Jobs map[string]struct {
		Services map[string]struct {
			Image string `yaml:"image"`
		} `yaml:"services"`
	} `yaml:"jobs"`
}

var exprRe = regexp.MustCompile(`\$\{\{\s*(.*?)\s*\}\}`)

// interpolate mirrors GitHub's string interpolation: each ${{ }} segment is
// evaluated and its result substituted as a string.
func interpolate(s string, inputs map[string]interface{}) (string, error) {
	var firstErr error
	out := exprRe.ReplaceAllStringFunc(s, func(m string) string {
		expr := exprRe.FindStringSubmatch(m)[1]
		in := exprparser.NewInterpeter(&exprparser.EvaluationEnvironment{Inputs: inputs}, exprparser.Config{})
		v, err := in.Evaluate(expr, exprparser.DefaultStatusCheckNone)
		if err != nil && firstErr == nil {
			firstErr = err
		}
		return fmt.Sprint(v)
	})
	return out, firstErr
}

type tc struct {
	id, desc        string
	image, version  string
	wantPG, wantMy  string
}

const digest = "pgvector/pgvector@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

func main() {
	raw, err := os.ReadFile(os.Args[1])
	if err != nil {
		panic(err)
	}
	var w wf
	if err := yaml.Unmarshal(raw, &w); err != nil {
		panic(err)
	}
	// workflow_call fills undeclared-by-caller inputs with their declared default ('').
	cases := []tc{
		{"AC-1", "neither input passed", "", "", "postgres:16", "mysql:8.0"},
		{"AC-2", "database_version=17", "", "17", "postgres:17", "mysql:17"},
		{"AC-3", "database_image=digest pin", digest, "", digest, "mysql:8.0"},
		{"AC-3b", "database_image=digest pin + database_version=17", digest, "17", digest, "mysql:17"},
		{"AC-3c", "database_image=tag ref", "pgvector/pgvector:pg17", "", "pgvector/pgvector:pg17", "mysql:8.0"},
		{"AC-4", "database_image set, database_version=8.4", digest, "8.4", digest, "mysql:8.4"},
	}
	jobs := make([]string, 0, len(w.Jobs))
	for j := range w.Jobs {
		jobs = append(jobs, j)
	}
	sort.Strings(jobs)
	fail := 0
	for _, c := range cases {
		fmt.Printf("%s (%s): inputs.database_image=%q inputs.database_version=%q\n", c.id, c.desc, c.image, c.version)
		inputs := map[string]interface{}{"database_image": c.image, "database_version": c.version}
		for _, j := range jobs {
			for name, svc := range w.Jobs[j].Services {
				want := c.wantPG
				if name == "mysql" {
					want = c.wantMy
				} else if name != "postgres" {
					continue
				}
				got, err := interpolate(svc.Image, inputs)
				ok := err == nil && got == want
				if !ok {
					fail++
				}
				fmt.Printf("  %-20s %-8s -> %-88s expected=%s ok=%v %s\n", j, name, got, want, ok, errStr(err))
			}
		}
	}
	if fail == 0 {
		fmt.Println("RESULT: PASS")
		return
	}
	fmt.Printf("RESULT: FAIL (%d mismatches)\n", fail)
	os.Exit(1)
}

func errStr(e error) string {
	if e == nil {
		return ""
	}
	return "err=" + e.Error()
}
