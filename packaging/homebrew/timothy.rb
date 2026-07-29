# frozen_string_literal: true

# This Formula belongs in todokr/homebrew-tap under Formula/timothy.rb.
# Update `url`, `sha256`, and `version` for each release. The GitHub Release
# body of timothy-cli includes the exact values to paste.
class Timothy < Formula
  desc "Upload LLM-generated HTML and share via time-limited URLs"
  homepage "https://github.com/todokr/timothy-cli"
  url "https://github.com/todokr/timothy-cli/releases/download/v0.1.0/tim"
  sha256 "REPLACE_WITH_SHA256_FROM_RELEASE"
  version "0.1.0"
  license "EPL-2.0"

  depends_on "node"

  def install
    libexec.install "tim" => "tim.mjs"
    (bin/"tim").write <<~SH
      #!/bin/bash
      exec node "#{libexec}/tim.mjs" "$@"
    SH
    (bin/"tim").chmod 0755
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/tim --version")
  end
end
