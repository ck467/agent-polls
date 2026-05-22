import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/.well-known/agent-skills/use-polls/SKILL.md": ["skills/**/*"],
  },
};

export default nextConfig;
