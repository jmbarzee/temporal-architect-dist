package main

import (
	"strings"
	"testing"
)

// fixtureSHAs builds a SHA map keyed by Platform.String() for tests. The
// hex values are recognizable (per-platform fake hashes) so failures show
// which platform's SHA didn't land where expected.
func fixtureSHAs() map[string]string {
	return map[string]string{
		"darwin-arm64": "aaaa111111111111111111111111111111111111111111111111111111111111",
		"darwin-amd64": "bbbb222222222222222222222222222222222222222222222222222222222222",
		"linux-arm64":  "cccc333333333333333333333333333333333333333333333333333333333333",
		"linux-amd64":  "dddd444444444444444444444444444444444444444444444444444444444444",
	}
}

func TestRenderFormula_Basics(t *testing.T) {
	got, err := renderFormula(FormulaData{
		Version:    "0.3.2",
		SourceRepo: "jmbarzee/temporal-architect",
		SHAs:       fixtureSHAs(),
	})
	if err != nil {
		t.Fatalf("renderFormula: %v", err)
	}

	wantSubstrings := []string{
		`class Twf < Formula`,
		`version "0.3.2"`,
		`homepage "https://github.com/jmbarzee/temporal-architect"`,
		// Per-platform URL + SHA blocks (Ruby formula contains exactly these tokens):
		`url "https://github.com/jmbarzee/temporal-architect/releases/download/v0.3.2/twf-v0.3.2-darwin-arm64.tar.gz"`,
		`sha256 "aaaa111111111111111111111111111111111111111111111111111111111111"`,
		`url "https://github.com/jmbarzee/temporal-architect/releases/download/v0.3.2/twf-v0.3.2-darwin-amd64.tar.gz"`,
		`sha256 "bbbb222222222222222222222222222222222222222222222222222222222222"`,
		`url "https://github.com/jmbarzee/temporal-architect/releases/download/v0.3.2/twf-v0.3.2-linux-arm64.tar.gz"`,
		`sha256 "cccc333333333333333333333333333333333333333333333333333333333333"`,
		`url "https://github.com/jmbarzee/temporal-architect/releases/download/v0.3.2/twf-v0.3.2-linux-amd64.tar.gz"`,
		`sha256 "dddd444444444444444444444444444444444444444444444444444444444444"`,
		`bin.install "twf"`,
	}
	for _, want := range wantSubstrings {
		if !strings.Contains(got, want) {
			t.Errorf("formula missing expected substring: %q\n--- full formula ---\n%s", want, got)
		}
	}
}

func TestRenderFormula_MissingSHARejected(t *testing.T) {
	shas := fixtureSHAs()
	delete(shas, "linux-arm64")
	if _, err := renderFormula(FormulaData{
		Version: "0.3.2", SourceRepo: "jmbarzee/temporal-architect", SHAs: shas,
	}); err == nil {
		t.Errorf("expected error when a platform SHA is missing")
	}
}

func TestRenderFormula_RepoIsInterpolated(t *testing.T) {
	got, err := renderFormula(FormulaData{
		Version:    "1.0.0",
		SourceRepo: "newowner/newrepo",
		SHAs:       fixtureSHAs(),
	})
	if err != nil {
		t.Fatalf("renderFormula: %v", err)
	}
	if !strings.Contains(got, `homepage "https://github.com/newowner/newrepo"`) {
		t.Errorf("homepage was not interpolated; got:\n%s", got)
	}
	if !strings.Contains(got, `url "https://github.com/newowner/newrepo/releases/download/v1.0.0/`) {
		t.Errorf("URL was not interpolated; got:\n%s", got)
	}
}

func TestArchiveURL(t *testing.T) {
	cases := []struct {
		prefix   string
		platform Platform
		want     string
	}{
		{"twf", Platform{"darwin", "arm64"}, "https://github.com/jmbarzee/temporal-architect/releases/download/v0.3.2/twf-v0.3.2-darwin-arm64.tar.gz"},
		{"twf", Platform{"linux", "amd64"}, "https://github.com/jmbarzee/temporal-architect/releases/download/v0.3.2/twf-v0.3.2-linux-amd64.tar.gz"},
		{"twf-serve", Platform{"darwin", "arm64"}, "https://github.com/jmbarzee/temporal-architect/releases/download/v0.3.2/twf-serve-v0.3.2-darwin-arm64.tar.gz"},
	}
	for _, c := range cases {
		got := archiveURL("jmbarzee/temporal-architect", c.prefix, "0.3.2", c.platform)
		if got != c.want {
			t.Errorf("archiveURL(%s,%s): got %q, want %q", c.prefix, c.platform, got, c.want)
		}
	}
}

// TestRenderFormula_TwfServe covers the parameterized (twf-serve) rendering:
// class name, archive prefix, install + test binary, and the dist source repo.
func TestRenderFormula_TwfServe(t *testing.T) {
	got, err := renderFormula(FormulaData{
		Version:       "0.14.0",
		SourceRepo:    "jmbarzee/temporal-architect-dist",
		Desc:          "Live Temporal design visualizer over local HTTP",
		SHAs:          fixtureSHAs(),
		Class:         pascalCase("twf-serve"),
		Binary:        "twf-serve",
		ArchivePrefix: "twf-serve",
	})
	if err != nil {
		t.Fatalf("renderFormula: %v", err)
	}
	wantSubstrings := []string{
		`class TwfServe < Formula`,
		`homepage "https://github.com/jmbarzee/temporal-architect-dist"`,
		`url "https://github.com/jmbarzee/temporal-architect-dist/releases/download/v0.14.0/twf-serve-v0.14.0-darwin-arm64.tar.gz"`,
		`url "https://github.com/jmbarzee/temporal-architect-dist/releases/download/v0.14.0/twf-serve-v0.14.0-linux-amd64.tar.gz"`,
		`bin.install "twf-serve"`,
		`shell_output("#{bin}/twf-serve --version")`,
	}
	for _, want := range wantSubstrings {
		if !strings.Contains(got, want) {
			t.Errorf("twf-serve formula missing %q\n--- full ---\n%s", want, got)
		}
	}
}

// TestPascalCase locks the class-name derivation.
func TestPascalCase(t *testing.T) {
	for in, want := range map[string]string{"twf": "Twf", "twf-serve": "TwfServe"} {
		if got := pascalCase(in); got != want {
			t.Errorf("pascalCase(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestPlatformsCanonical(t *testing.T) {
	// Lock the platform list to the brew-supported set; if anyone adds windows
	// or changes order, this test fails so they think twice.
	want := []Platform{
		{"darwin", "arm64"},
		{"darwin", "amd64"},
		{"linux", "arm64"},
		{"linux", "amd64"},
	}
	if len(Platforms) != len(want) {
		t.Fatalf("Platforms len: got %d, want %d", len(Platforms), len(want))
	}
	for i := range want {
		if Platforms[i] != want[i] {
			t.Errorf("Platforms[%d]: got %v, want %v", i, Platforms[i], want[i])
		}
	}
}
