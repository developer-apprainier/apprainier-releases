import AppRainierSdk
import React
import SwiftUI
import UIKit

@objc(AppRainierLiveCardViewManager)
final class AppRainierLiveCardViewManager: RCTViewManager {
    override static func requiresMainQueueSetup() -> Bool {
        true
    }

    override func view() -> UIView! {
        AppRainierLiveCardHostView()
    }
}

final class AppRainierLiveCardHostView: UIView {
    @objc var triggerId: NSString? {
        didSet { reloadIfNeeded() }
    }

    @objc var refreshKey: NSNumber? {
        didSet { reload() }
    }

    @objc var onCardClick: RCTDirectEventBlock?
    @objc var onCardReady: RCTDirectEventBlock?
    @objc var onCardUnavailable: RCTDirectEventBlock?

    private var hostingController: UIHostingController<AnyView>?
    private var loadedTriggerId: String?
    private var loadToken = 0

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        backgroundColor = .clear
    }

    private func reloadIfNeeded() {
        let currentTriggerId = normalizedTriggerId
        guard currentTriggerId != loadedTriggerId else { return }
        reload()
    }

    private func reload() {
        let currentTriggerId = normalizedTriggerId
        loadedTriggerId = currentTriggerId
        removeHostedView()

        guard let currentTriggerId else { return }

        loadToken += 1
        let token = loadToken

        AppRainier.shared.createLiveCardView(
            triggerId: currentTriggerId,
            onTap: { [weak self] deepLink in
                self?.emitClick(triggerId: currentTriggerId, deepLink: deepLink)
            },
            completion: { [weak self] liveCardView in
                DispatchQueue.main.async {
                    guard let self, token == self.loadToken, currentTriggerId == self.loadedTriggerId else {
                        return
                    }

                    guard let liveCardView else {
                        self.emitUnavailable(triggerId: currentTriggerId)
                        return
                    }

                    self.install(liveCardView)
                    self.emitReady(triggerId: currentTriggerId)
                }
            }
        )
    }

    private var normalizedTriggerId: String? {
        triggerId?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
    }

    private func install(_ rootView: AnyView) {
        removeHostedView()

        let controller = UIHostingController(rootView: rootView)
        controller.view.translatesAutoresizingMaskIntoConstraints = false
        controller.view.backgroundColor = .clear

        addSubview(controller.view)
        NSLayoutConstraint.activate([
            controller.view.leadingAnchor.constraint(equalTo: leadingAnchor),
            controller.view.trailingAnchor.constraint(equalTo: trailingAnchor),
            controller.view.topAnchor.constraint(equalTo: topAnchor),
            controller.view.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])

        hostingController = controller
    }

    private func removeHostedView() {
        hostingController?.view.removeFromSuperview()
        hostingController = nil
    }

    private func emitClick(triggerId: String, deepLink: String?) {
        var payload: [String: Any] = [
            "triggerId": triggerId,
            "actionType": "deeplink",
        ]
        if let deepLink {
            payload["actionTarget"] = deepLink
        }
        onCardClick?(payload)
    }

    private func emitUnavailable(triggerId: String) {
        onCardUnavailable?(["triggerId": triggerId])
    }

    private func emitReady(triggerId: String) {
        onCardReady?(["triggerId": triggerId])
    }
}

private extension NSString {
    func trimmingCharacters(in set: CharacterSet) -> String {
        (self as String).trimmingCharacters(in: set)
    }
}

private extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}
