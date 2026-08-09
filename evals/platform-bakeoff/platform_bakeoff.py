#!/usr/bin/env python3
"""Run identical deterministic experiments through real evaluation frameworks."""

import argparse
import json
import os
import time
from pathlib import Path

ROOT = Path(__file__).parent
CASES = json.loads((ROOT / "corpus.json").read_text())


def coverage(output, required):
    text = output.lower()
    return sum(term.lower() in text for term in required) / len(required)


def rows(variant):
    return [
        {
            "input": {
                "id": case["id"],
                "prompt": case["input"],
                "variant": variant,
                "actual_output": case[variant],
            },
            "expected": case["required"],
            "output": case[variant],
        }
        for case in CASES
    ]


def run_braintrust(variant):
    from braintrust import Eval

    started = time.perf_counter()
    result = Eval(
        "gstack-platform-bakeoff",
        data=rows(variant),
        task=lambda item: item["actual_output"],
        scores=[lambda output, expected: coverage(output, expected)],
        experiment_name=f"{variant}-local",
        no_send_logs=True,
        metadata={"corpus": "gstack-platform-bakeoff-v1", "synthetic": True},
    )
    return {
        "platform": "braintrust",
        "variant": variant,
        "duration_ms": round((time.perf_counter() - started) * 1000, 2),
        "cases": len(CASES),
        "scores": [coverage(x["output"], x["expected"]) for x in rows(variant)],
        "summary": str(result.summary),
        "mode": "real SDK, local no-send-logs",
    }


def run_langfuse(variant):
    from langfuse import Langfuse
    from langfuse.experiment import Evaluation

    client = Langfuse(
        public_key=os.environ["LANGFUSE_PUBLIC_KEY"],
        secret_key=os.environ["LANGFUSE_SECRET_KEY"],
        host=os.environ.get("LANGFUSE_HOST", "http://localhost:3000"),
    )
    dataset_name = "gstack-platform-bakeoff-v1"
    client.create_dataset(name=dataset_name, description="Synthetic GStack platform bake-off")
    for item in rows(variant):
        client.create_dataset_item(
            id=f'{item["input"]["id"]}-{variant}',
            dataset_name=dataset_name,
            input=item["input"],
            expected_output=item["expected"],
            metadata={"synthetic": True},
        )
    dataset = client.get_dataset(dataset_name)
    selected = [item for item in dataset.items if item.input.get("variant") == variant]
    started = time.perf_counter()
    result = client.run_experiment(
        name="gstack-platform-bakeoff",
        run_name=f"{variant}-{int(time.time())}",
        data=selected,
        task=lambda item: item.input["actual_output"],
        evaluators=[
            lambda input, output, expected_output, **_: Evaluation(
                name="required-term-coverage",
                value=coverage(output, expected_output),
            )
        ],
        metadata={"corpus": "gstack-platform-bakeoff-v1", "synthetic": True},
    )
    client.flush()
    return {
        "platform": "langfuse",
        "variant": variant,
        "duration_ms": round((time.perf_counter() - started) * 1000, 2),
        "cases": len(selected),
        "scores": [coverage(x["output"], x["expected"]) for x in rows(variant)],
        "summary": str(result),
        "mode": "real self-hosted stack and SDK",
    }


def gate_confident_upload(env):
    """Key presence alone never equals upload consent (repo egress rule):
    scrub CONFIDENT_API_KEY unless GSTACK_CONFIDENT_UPLOAD=1 opts in."""
    if env.get("GSTACK_CONFIDENT_UPLOAD") != "1":
        env.pop("CONFIDENT_API_KEY", None)
    return env


def run_deepeval(variant):
    gate_confident_upload(os.environ)  # before import: deepeval reads the key eagerly
    os.environ.setdefault("DEEPEVAL_TELEMETRY_OPT_OUT", "YES")  # default-on telemetry to Confident AI
    from deepeval import evaluate
    from deepeval.evaluate.configs import DisplayConfig
    from deepeval.metrics import BaseMetric
    from deepeval.test_case import LLMTestCase

    class RequiredTermCoverage(BaseMetric):
        threshold = 1.0

        def measure(self, test_case, _show_indicator=True):
            required = json.loads(test_case.expected_output)
            self.score = coverage(test_case.actual_output, required)
            self.success = self.score >= self.threshold
            self.reason = f"{self.score:.0%} required-term coverage"
            return self.score

        async def a_measure(self, test_case, _show_indicator=True):
            return self.measure(test_case, _show_indicator)

        def is_successful(self):
            return self.success

    cases = [
        LLMTestCase(
            input=item["input"]["prompt"],
            actual_output=item["output"],
            expected_output=json.dumps(item["expected"]),
            additional_metadata={"id": item["input"]["id"], "synthetic": True},
        )
        for item in rows(variant)
    ]
    started = time.perf_counter()
    result = evaluate(
        test_cases=cases,
        metrics=[RequiredTermCoverage()],
        identifier=f"gstack-platform-bakeoff-{variant}",
        display_config=DisplayConfig(
            show_indicator=False,
            print_results=False,
            inspect_after_run=False,
            results_folder=str(ROOT / "results"),
        ),
    )
    return {
        "platform": "deepeval",
        "variant": variant,
        "duration_ms": round((time.perf_counter() - started) * 1000, 2),
        "cases": len(cases),
        "scores": [coverage(x["output"], x["expected"]) for x in rows(variant)],
        "summary": str(result),
        "mode": "real local framework",
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("platform", choices=["langfuse", "braintrust", "deepeval"])
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    runner = globals()[f"run_{args.platform}"]
    report = {"runs": [runner("baseline"), runner("candidate")]}
    encoded = json.dumps(report, indent=2, default=str)
    if args.output:
        args.output.write_text(encoded + "\n")
    print(encoded)


if __name__ == "__main__":
    main()
