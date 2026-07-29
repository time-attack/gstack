// swift-tools-version:5.9
//
// gen-accessors-tool — SwiftPM tool that reads an app's Swift source via
// swift-syntax, finds @Observable classes with @Snapshotable-marked fields,
// and emits StateAccessor.swift for each one.
//
// First build is 2-5 min on a cold machine (swift-syntax compile chain).
// Subsequent runs are content-hash-cached and finish in ~50ms.
//
// Invocation:
//   swift run --package-path ios-qa/scripts/gen-accessors-tool \
//     gen-accessors --input <swift-source-dir> [--output <out-dir>]

import PackageDescription

let package = Package(
    name: "gen-accessors-tool",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "gen-accessors", targets: ["GenAccessors"]),
    ],
    dependencies: [
        .package(url: "https://github.com/swiftlang/swift-syntax.git", from: "510.0.0"),
    ],
    targets: [
        .executableTarget(
            name: "GenAccessors",
            dependencies: [
                .product(name: "SwiftSyntax", package: "swift-syntax"),
                .product(name: "SwiftParser", package: "swift-syntax"),
            ],
            path: "Sources/GenAccessors"
        ),
        // No testTarget: this package ships no Tests/ directory, and SwiftPM
        // validates every declared target path before building anything, so a
        // phantom testTarget made `swift run gen-accessors` fail on first use
        // (gstack#1735). The parser logic is covered by the TS port's tests
        // (ios-qa/scripts/gen-accessors.test.ts).
    ]
)
