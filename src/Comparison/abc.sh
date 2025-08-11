#!/bin/bash

# Manual benchmark parameters
BENCHMARK_CPU=2      # Set the benchmark CPU core number here
BENCHMARK_RAM=32     # Set the benchmark RAM (in MB) here
echo "=========================="
echo "Benchmark Parameters"
echo "=========================="
echo "CPU Cores Required: $BENCHMARK_CPU"
echo "RAM Required: ${BENCHMARK_RAM}MB"
echo "=========================="

# Path to the sample JSON file
SAMPLE_FILE="sample.json"

# Extract CPU and RAM values from the sample JSON file
sample_cpu=$(jq -r '.cpu_cores' "$SAMPLE_FILE")
sample_ram=$(jq -r '.memory' "$SAMPLE_FILE" | sed 's/Gi//')

echo "System Information:"
echo "-----------------------------"
echo "CPU Cores Available: $sample_cpu"
echo "RAM Available: ${sample_ram}GB"
echo "=========================="

# Initialize a flag to track the overall test result
overall_pass=true

# Compare CPU values
if [[ $(echo "$sample_cpu >= $BENCHMARK_CPU" | bc -l) -eq 1 ]]; then
    echo "[PASS] CPU core requirement met (Available: $sample_cpu, Required: $BENCHMARK_CPU)"
else
    echo "[FAIL] CPU core requirement not met (Available: $sample_cpu, Required: $BENCHMARK_CPU)"
    overall_pass=false
fi

# Compare RAM values
if [[ $(echo "$sample_ram >= $BENCHMARK_RAM" | bc -l) -eq 1 ]]; then
    echo "[PASS] RAM requirement met (Available: ${sample_ram}GB, Required: ${BENCHMARK_RAM}MB)"
else
    echo "[FAIL] RAM requirement not met (Available: ${sample_ram}GB, Required: ${BENCHMARK_RAM}MB)"
    overall_pass=false
fi

# Check overall result
echo "=========================="
if [[ "$overall_pass" == true ]]; then
    echo "RESULT: All system requirements PASSED. The system is suitable."
else
    echo "RESULT: Some system requirements FAILED. The system is not suitable."
fi
echo "=========================="

