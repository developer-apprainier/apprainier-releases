import AppRainierSdk
import Flutter
import SwiftUI
import UIKit

public final class FlutterApprainierPlugin: NSObject, FlutterPlugin, FlutterStreamHandler {
    private let sdk = AppRainier.shared
    private var eventSink: FlutterEventSink?
    private weak var activeSurveyViewController: UIViewController?
    private weak var activeAnnouncementViewController: UIViewController?

    public static func register(with registrar: FlutterPluginRegistrar) {
        let instance = FlutterApprainierPlugin()
        let methodChannel = FlutterMethodChannel(name: "flutter_apprainier_plugin", binaryMessenger: registrar.messenger())
        let eventChannel = FlutterEventChannel(name: "flutter_apprainier_plugin/events", binaryMessenger: registrar.messenger())

        registrar.addMethodCallDelegate(instance, channel: methodChannel)
        eventChannel.setStreamHandler(instance)
        registrar.register(
            AppRainierLiveCardPlatformViewFactory(messenger: registrar.messenger()),
            withId: "flutter_apprainier_plugin/live_card"
        )
    }

    public func onListen(withArguments arguments: Any?, eventSink events: @escaping FlutterEventSink) -> FlutterError? {
        eventSink = events
        return nil
    }

    public func onCancel(withArguments arguments: Any?) -> FlutterError? {
        eventSink = nil
        return nil
    }

    public func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
        switch call.method {
        case "initialize":
            Task { @MainActor in
                let selectedEnvironment = Environment(rawValue: stringArg(call, "environment").lowercased()) ?? .production
                sdk.initialize(apiKey: stringArg(call, "apiKey"), environment: selectedEnvironment) { state in
                    result(self.stateDescription(state))
                }
            }
        case "initializeWithConfig":
            Task { @MainActor in
                do {
                    let data = try JSONSerialization.data(withJSONObject: dictionaryArg(call, "config"))
                    let json = String(decoding: data, as: UTF8.self)
                    sdk.initialize(configJSON: json) { state in
                        result(self.stateDescription(state))
                    }
                } catch {
                    result(FlutterError(code: "APPRAINIER_INITIALIZE_FAILED", message: error.localizedDescription, details: nil))
                }
            }
        case "identify":
            Task { @MainActor in
                sdk.identify(userId: stringArg(call, "userId"), traits: dictionaryArg(call, "traits"))
                result(true)
            }
        case "resetUser":
            Task { @MainActor in
                sdk.resetUser(reason: optionalStringArg(call, "reason") ?? "manual_reset")
                result(true)
            }
        case "setUserProfile":
            Task { @MainActor in
                sdk.setUserProfile(
                    userId: stringArg(call, "userId"),
                    userType: stringArg(call, "userType"),
                    userProperties: dictionaryArg(call, "userProperties"),
                    appProperties: dictionaryArg(call, "appProperties"),
                    deviceProperties: dictionaryArg(call, "deviceProperties"),
                    customProperties: dictionaryArg(call, "customProperties")
                )
                result(true)
            }
        case "setUserProperty":
            setProperty(call, result: result) { self.sdk.setUserProperty($0, value: $1 as Any) }
        case "setAppProperty":
            setProperty(call, result: result) { self.sdk.setAppProperty($0, value: $1 as Any) }
        case "setDeviceProperty":
            setProperty(call, result: result) { self.sdk.setDeviceProperty($0, value: $1 as Any) }
        case "setCustomProperty":
            setProperty(call, result: result) { self.sdk.setCustomProperty($0, value: $1 as Any) }
        case "setUserType":
            Task { @MainActor in
                sdk.setUserType(stringArg(call, "userType"))
                result(true)
            }
        case "refreshFeatureFlags":
            Task { @MainActor in
                await sdk.refreshFeatureFlags(force: boolArg(call, "force"))
                result(true)
            }
        case "getFeatureFlag":
            Task { @MainActor in
                guard let value = await sdk.getFeatureFlagValue(stringArg(call, "flagKey")) else {
                    result(bridgeValue(arg(call, "defaultValue")))
                    return
                }
                result(anyValue(from: value) ?? bridgeValue(arg(call, "defaultValue")))
            }
        case "getExperimentVariation":
            Task { @MainActor in
                result(anyEncodable(await sdk.getExperimentVariation(stringArg(call, "flagKey"))))
            }
        case "getExperimentConfig":
            Task { @MainActor in
                result(anyEncodable(await sdk.getExperimentConfig(stringArg(call, "flagKey"))))
            }
        case "trackExperimentExposure":
            Task { @MainActor in
                await sdk.trackExperimentExposure(stringArg(call, "flagKey"), context: dictionaryArg(call, "context"))
                result(true)
            }
        case "trackExperimentConversion":
            Task { @MainActor in
                await sdk.trackExperimentConversion(
                    stringArg(call, "flagKey"),
                    goalId: optionalStringArg(call, "goalId"),
                    value: bridgeValue(arg(call, "value")),
                    context: dictionaryArg(call, "context")
                )
                result(true)
            }
        case "trackEvent":
            Task { @MainActor in
                sdk.trackEvent(
                    stringArg(call, "eventName"),
                    properties: dictionaryArg(call, "properties"),
                    eventType: optionalStringArg(call, "eventType") ?? "custom"
                )
                result(true)
            }
        case "refreshSurveys":
            Task { @MainActor in
                await sdk.refreshSurveys(force: boolArg(call, "force"))
                result(true)
            }
        case "canShowSurvey":
            Task { @MainActor in
                result(await sdk.canShowSurvey(stringArg(call, "eventName")))
            }
        case "showSurvey":
            Task { @MainActor in
                let shown = await sdk.showSurvey(stringArg(call, "eventName"), callback: SurveyBridgeCallback(plugin: self))
                if shown && !presentOverlay(mode: .survey, result: result) {
                    return
                }
                result(shown)
            }
        case "refreshAnnouncements":
            Task { @MainActor in
                await sdk.refreshAnnouncements(force: boolArg(call, "force"))
                result(true)
            }
        case "canShowAnnouncement":
            Task { @MainActor in
                result(await sdk.canShowAnnouncement(stringArg(call, "eventName")))
            }
        case "showAnnouncement":
            Task { @MainActor in
                let shown = await sdk.showAnnouncement(stringArg(call, "eventName"), callback: AnnouncementBridgeCallback(plugin: self))
                if shown && !presentOverlay(mode: .announcement, result: result) {
                    return
                }
                result(shown)
            }
        case "refreshLiveCards":
            Task { @MainActor in
                await sdk.refreshLiveCards(force: boolArg(call, "force", fallback: true))
                result(true)
            }
        case "hasLiveCard":
            Task { @MainActor in
                result(await sdk.hasLiveCard(triggerId: stringArg(call, "triggerId")))
            }
        case "refreshMessageCenter":
            Task { @MainActor in
                await sdk.refreshMessageCenter()
                result(true)
            }
        case "openMessageCenter":
            openMessageCenter(call, result: result)
        case "getUnreadMessageCount":
            Task { @MainActor in
                await sdk.refreshMessageCenter()
                result(sdk.getUnreadMessageCount())
            }
        case "onPushTokenRefreshed":
            Task { @MainActor in
                sdk.onPushTokenRefreshed(stringArg(call, "token"))
                result(true)
            }
        case "isAppRainierPush":
            Task { @MainActor in
                result(sdk.isAppRainierPush(userInfo: notificationUserInfo(from: dictionaryArg(call, "payload"))))
            }
        case "handlePushMessage":
            Task { @MainActor in
                result(sdk.handlePushMessage(userInfo: notificationUserInfo(from: dictionaryArg(call, "payload"))))
            }
        case "getUserId":
            Task { @MainActor in
                result(sdk.getUserId())
            }
        case "getUserDebugState":
            Task { @MainActor in
                result(anyEncodable(sdk.getUserDebugState()))
            }
        case "flush":
            Task { @MainActor in
                sdk.flush()
                result(true)
            }
        case "shutdown":
            Task { @MainActor in
                sdk.shutdown()
                result(true)
            }
        default:
            result(FlutterMethodNotImplemented)
        }
    }

    fileprivate func emit(name: String, payload: [String: Any?]) {
        DispatchQueue.main.async { [weak self] in
            self?.eventSink?([
                "name": name,
                "payload": payload.compactMapValues { self?.bridgeValue($0) },
            ])
        }
    }

    private func setProperty(
        _ call: FlutterMethodCall,
        result: @escaping FlutterResult,
        block: @escaping @MainActor (String, Any?) -> Void
    ) {
        Task { @MainActor in
            block(stringArg(call, "key"), bridgeValue(arg(call, "value")))
            result(true)
        }
    }

    private func openMessageCenter(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
        Task { @MainActor in
            await sdk.refreshMessageCenter()
            guard sdk.canShowMessageCenter() else {
                result(false)
                return
            }
            sdk.openMessageCenter(
                initialTab: optionalStringArg(call, "initialTab"),
                announcementId: optionalStringArg(call, "announcementId"),
                threadId: optionalStringArg(call, "threadId")
            )
            var presentedViewController: UIViewController?
            let viewController = UIHostingController(
                rootView: MessageCenterView(sdk: sdk) {
                    presentedViewController?.dismiss(animated: true)
                }
            )
            presentedViewController = viewController
            viewController.modalPresentationStyle = .fullScreen

            guard let presenter = topViewController() else {
                result(FlutterError(code: "APPRAINIER_NO_VIEW_CONTROLLER", message: "No view controller is available to present Message Center.", details: nil))
                return
            }

            presenter.present(viewController, animated: true) {
                result(true)
            }
        }
    }

    @MainActor
    private func presentOverlay(mode: AppRainierOverlayMode, result: @escaping FlutterResult) -> Bool {
        switch mode {
        case .survey where activeSurveyViewController != nil:
            return true
        case .announcement where activeAnnouncementViewController != nil:
            return true
        default:
            break
        }

        guard let presenter = topViewController() else {
            switch mode {
            case .survey:
                sdk.dismissCurrentSurvey()
            case .announcement:
                sdk.dismissCurrentAnnouncement()
            }
            result(FlutterError(code: "APPRAINIER_NO_VIEW_CONTROLLER", message: "No view controller is available to present AppRainier content.", details: nil))
            return false
        }

        let viewController = UIHostingController(
            rootView: AppRainierModalOverlayView(sdk: sdk, mode: mode) { [weak self] in
                switch mode {
                case .survey:
                    self?.activeSurveyViewController = nil
                case .announcement:
                    self?.activeAnnouncementViewController = nil
                }
            }
        )
        viewController.modalPresentationStyle = .overFullScreen
        viewController.modalTransitionStyle = .crossDissolve
        viewController.view.backgroundColor = .clear

        switch mode {
        case .survey:
            activeSurveyViewController = viewController
        case .announcement:
            activeAnnouncementViewController = viewController
        }

        presenter.present(viewController, animated: true)
        return true
    }

    @MainActor
    private func topViewController(
        from root: UIViewController? = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow }?
            .rootViewController
    ) -> UIViewController? {
        if let navigation = root as? UINavigationController {
            return topViewController(from: navigation.visibleViewController)
        }
        if let tab = root as? UITabBarController {
            return topViewController(from: tab.selectedViewController)
        }
        if let presented = root?.presentedViewController {
            return topViewController(from: presented)
        }
        return root
    }

    private func arg(_ call: FlutterMethodCall, _ key: String) -> Any? {
        (call.arguments as? [String: Any?])?[key] ?? nil
    }

    private func stringArg(_ call: FlutterMethodCall, _ key: String) -> String {
        guard let value = optionalStringArg(call, key) else {
            fatalError("Missing required AppRainier argument: \(key)")
        }
        return value
    }

    private func optionalStringArg(_ call: FlutterMethodCall, _ key: String) -> String? {
        let trimmed = (arg(call, key) as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed?.isEmpty == false ? trimmed : nil
    }

    private func boolArg(_ call: FlutterMethodCall, _ key: String, fallback: Bool = false) -> Bool {
        (arg(call, key) as? Bool) ?? fallback
    }

    private func dictionaryArg(_ call: FlutterMethodCall, _ key: String) -> [String: Any] {
        guard let source = arg(call, key) as? [String: Any?] else { return [:] }
        return dictionary(from: source)
    }

    private func dictionary(from source: [String: Any?]) -> [String: Any] {
        var result: [String: Any] = [:]
        source.forEach { key, value in
            guard let bridged = bridgeValue(value) else { return }
            result[key] = bridged
        }
        return result
    }

    private func bridgeValue(_ value: Any?) -> Any? {
        switch value {
        case nil:
            return nil
        case is NSNull:
            return nil
        case let dictionary as [String: Any?]:
            return self.dictionary(from: dictionary)
        case let nsDictionary as NSDictionary:
            var result: [String: Any] = [:]
            nsDictionary.forEach { key, value in
                guard let key = key as? String, let bridged = bridgeValue(value) else { return }
                result[key] = bridged
            }
            return result
        case let array as [Any?]:
            return array.compactMap { bridgeValue($0) }
        case let nsArray as NSArray:
            return nsArray.compactMap { bridgeValue($0) }
        case let number as NSNumber:
            return number
        case let string as String:
            return string
        default:
            return value
        }
    }

    private func anyValue(from value: JSONValue) -> Any? {
        switch value {
        case .string(let string):
            return string
        case .number(let number):
            return number
        case .bool(let bool):
            return bool
        case .object(let object):
            return object.mapValues { anyValue(from: $0) }
        case .array(let array):
            return array.map { anyValue(from: $0) }
        case .null:
            return nil
        }
    }

    private func anyEncodable<T: Encodable>(_ value: T?) -> Any? {
        guard let value else { return nil }
        do {
            let data = try JSONEncoder().encode(value)
            return try JSONSerialization.jsonObject(with: data)
        } catch {
            return nil
        }
    }

    private func stateDescription(_ state: SDKState) -> String {
        switch state {
        case .notInitialized:
            return "not_initialized"
        case .initializing:
            return "initializing"
        case .ready:
            return "ready"
        case .error(let message):
            return "error:\(message)"
        case .shutdown:
            return "shutdown"
        @unknown default:
            return "unknown"
        }
    }

    private func notificationUserInfo(from source: [String: Any]) -> [AnyHashable: Any] {
        var result: [AnyHashable: Any] = [:]
        source.forEach { key, value in
            result[AnyHashable(key)] = value
        }
        return result
    }
}

private enum AppRainierOverlayMode {
    case survey
    case announcement
}

private struct AppRainierModalOverlayView: View {
    @ObservedObject var sdk: AppRainier
    let mode: AppRainierOverlayMode
    let onDismiss: () -> Void

    @SwiftUI.Environment(\.dismiss) private var dismiss: SwiftUI.DismissAction

    var body: some View {
        ZStack {
            Color.clear.ignoresSafeArea()

            switch mode {
            case .survey:
                if let survey = sdk.surveyManager?.currentSurvey {
                    SurveyPresenterView(sdk: sdk, survey: survey)
                }
            case .announcement:
                if let announcement = sdk.announcementManager?.currentAnnouncement {
                    AnnouncementPresenterView(sdk: sdk, announcement: announcement)
                }
            }
        }
        .background(Color.clear)
        .onAppear(perform: dismissIfNeeded)
        .onChange(of: activeContentId) { _ in
            dismissIfNeeded()
        }
    }

    private var activeContentId: String? {
        switch mode {
        case .survey:
            return sdk.surveyManager?.currentSurvey?.id
        case .announcement:
            return sdk.announcementManager?.currentAnnouncement?.id
        }
    }

    private func dismissIfNeeded() {
        guard activeContentId == nil else { return }
        onDismiss()
        dismiss()
    }
}

private final class SurveyBridgeCallback: SurveyCallback, @unchecked Sendable {
    weak var plugin: FlutterApprainierPlugin?

    init(plugin: FlutterApprainierPlugin) {
        self.plugin = plugin
    }

    func onSurveySubmitted(_ result: SurveyPresentationResult) {
        plugin?.emit(name: "AppRainierSurveySubmitted", payload: [
            "surveyId": result.surveyId,
            "responses": responses(result.responses),
            "targetScreen": result.targetScreen,
            "deepLink": result.deepLink,
        ])
    }

    func onSurveyCancelled(surveyId: String, targetScreen: String?, deepLink: String?) {
        plugin?.emit(name: "AppRainierSurveyCancelled", payload: [
            "surveyId": surveyId,
            "targetScreen": targetScreen,
            "deepLink": deepLink,
        ])
    }

    func onSurveyDismissed(surveyId: String) {
        plugin?.emit(name: "AppRainierSurveyDismissed", payload: [
            "surveyId": surveyId,
        ])
    }

    private func responses(_ responses: [String: JSONValue]) -> Any? {
        do {
            let data = try JSONEncoder().encode(responses)
            return try JSONSerialization.jsonObject(with: data)
        } catch {
            return nil
        }
    }
}

private final class AnnouncementBridgeCallback: AnnouncementCallback, @unchecked Sendable {
    weak var plugin: FlutterApprainierPlugin?

    init(plugin: FlutterApprainierPlugin) {
        self.plugin = plugin
    }

    func onAnnouncementSubmitted(_ result: AnnouncementPresentationResult) {
        plugin?.emit(name: "AppRainierAnnouncementSubmitted", payload: [
            "announcementId": result.announcementId,
            "responses": responses(result.responses),
            "targetScreen": result.targetScreen,
            "deepLink": result.deepLink,
        ])
    }

    func onAnnouncementCancelled(announcementId: String, targetScreen: String?, deepLink: String?) {
        plugin?.emit(name: "AppRainierAnnouncementCancelled", payload: [
            "announcementId": announcementId,
            "targetScreen": targetScreen,
            "deepLink": deepLink,
        ])
    }

    func onAnnouncementDismissed(announcementId: String) {
        plugin?.emit(name: "AppRainierAnnouncementDismissed", payload: [
            "announcementId": announcementId,
        ])
    }

    private func responses(_ responses: [String: JSONValue]) -> Any? {
        do {
            let data = try JSONEncoder().encode(responses)
            return try JSONSerialization.jsonObject(with: data)
        } catch {
            return nil
        }
    }
}

private final class AppRainierLiveCardPlatformViewFactory: NSObject, FlutterPlatformViewFactory {
    private let messenger: FlutterBinaryMessenger

    init(messenger: FlutterBinaryMessenger) {
        self.messenger = messenger
        super.init()
    }

    func createArgsCodec() -> FlutterMessageCodec & NSObjectProtocol {
        FlutterStandardMessageCodec.sharedInstance()
    }

    func create(
        withFrame frame: CGRect,
        viewIdentifier viewId: Int64,
        arguments args: Any?
    ) -> FlutterPlatformView {
        AppRainierLiveCardPlatformView(frame: frame, viewId: viewId, args: args, messenger: messenger)
    }
}

private final class AppRainierLiveCardPlatformView: NSObject, FlutterPlatformView {
    private let container: UIView
    private let channel: FlutterMethodChannel
    private var hostingController: UIHostingController<AnyView>?
    private var triggerId: String?
    private var loadToken = 0

    init(frame: CGRect, viewId: Int64, args: Any?, messenger: FlutterBinaryMessenger) {
        container = UIView(frame: frame)
        channel = FlutterMethodChannel(name: "flutter_apprainier_plugin/live_card_\(viewId)", binaryMessenger: messenger)
        triggerId = (args as? [String: Any?])?["triggerId"] as? String
        super.init()
        container.backgroundColor = .clear
        reload()
    }

    func view() -> UIView {
        container
    }

    private func reload() {
        let currentTriggerId = triggerId?.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let currentTriggerId, !currentTriggerId.isEmpty else { return }

        removeHostedView()
        loadToken += 1
        let token = loadToken

        Task { @MainActor in
            AppRainier.shared.createLiveCardView(
                triggerId: currentTriggerId,
                onTap: { [weak self] deepLink in
                    self?.emit("onCardClick", payload: [
                        "triggerId": currentTriggerId,
                        "actionType": "deeplink",
                        "actionTarget": deepLink,
                    ])
                },
                completion: { [weak self] liveCardView in
                    DispatchQueue.main.async {
                        guard let self, token == self.loadToken else { return }

                        guard let liveCardView else {
                            self.emit("onCardUnavailable", payload: ["triggerId": currentTriggerId])
                            return
                        }

                        self.install(liveCardView)
                        self.emit("onCardReady", payload: ["triggerId": currentTriggerId])
                    }
                }
            )
        }
    }

    private func install(_ rootView: AnyView) {
        removeHostedView()

        let controller = UIHostingController(rootView: rootView)
        controller.view.translatesAutoresizingMaskIntoConstraints = false
        controller.view.backgroundColor = .clear
        container.addSubview(controller.view)
        NSLayoutConstraint.activate([
            controller.view.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            controller.view.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            controller.view.topAnchor.constraint(equalTo: container.topAnchor),
            controller.view.bottomAnchor.constraint(equalTo: container.bottomAnchor),
        ])
        hostingController = controller
    }

    private func removeHostedView() {
        hostingController?.view.removeFromSuperview()
        hostingController = nil
    }

    private func emit(_ method: String, payload: [String: Any?]) {
        channel.invokeMethod(method, arguments: payload.compactMapValues { $0 })
    }
}
