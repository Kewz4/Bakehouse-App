// swift-tools-version: 5.9
import PackageDescription

// Núcleo sin SwiftUI: modelos, unidades, cuentas del negocio y sincronización.
// Se mantiene libre de UIKit/SwiftUI a propósito, para poder compilarlo y
// probarlo también en Linux (así el motor de combinación se prueba en CI sin
// necesidad de un Mac).
let package = Package(
    name: "OlivoLioraCore",
    platforms: [.iOS(.v17), .macOS(.v13)],
    products: [
        .library(name: "OlivoLioraCore", targets: ["OlivoLioraCore"])
    ],
    targets: [
        .target(name: "OlivoLioraCore"),
        .testTarget(
            name: "OlivoLioraCoreTests",
            dependencies: ["OlivoLioraCore"],
            resources: [.copy("merge-conformance.json")])
    ]
)
