import AppRainierSdk
import Foundation
import React
import SwiftUI
import UIKit

@objc(AppRainierReactNativePlugin)
final class AppRainierReactNativePlugin: RCTEventEmitter {
    private let sdk = AppRainier.shared
    private weak var activeSurveyViewController: UIViewController?
    private weak var activeAnnouncementViewController: UIViewController?

    override static func requiresMainQueueSetup() -> Bool {
        true
    }

    override func supportedEvents() -> [String]! {
        [
            "AppRainierSurveySubmitted",
            "AppRainierSurveyCancelled",
            "AppRainierSurveyDismissed",
            "AppRainierAnnouncementSubmitted",
            "AppRainierAnnouncementCancelled",
            "AppRainierAnnouncementDismissed",
        ]
    }

    @objc(initialize:environment:resolver:rejecter:)
    func initialize(
        _ apiKey: String,
        environment: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        Task { @MainActor in
            let selectedEnvironment = Environment(rawValue: environment.lowercased()) ?? .production
            sdk.initialize(apiKey: apiKey, environment: selectedEnvironment) { state in
                resolve(self.stateDescription(state))
            }
        }
    }

    @objc(initializeWithConfig:resolver:rejecter:)
    func initializeWithConfig(
        _ config: NSDictionary,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        Task { @MainActor in
            do {
                let data = try JSONSerialization.data(withJSONObject: dictionary(from: config))
                let json = String(decoding: data, as: UTF8.self)
                sdk.initialize(configJSON: json) { state in
                    resolve(self.stateDescription(state))
                }
            } catch {
                reject("APPRAINIER_INITIALIZE_FAILED", error.localizedDescription, error)
            }
        }
    }

    @objc(identify:traits:resolver:rejecter:)
    func identify(
        _ userId: String,
        traits: NSDictionary?,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: RCTPromiseRejectBlock
    ) {
        Task { @MainActor in
            sdk.identify(userId: userId, traits: dictionary(from: traits))
            resolve(true)
        }
    }

    @objc(resetUser:resolver:rejecter:)
    func resetUser(
        _ reason: String?,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: RCTPromiseRejectBlock
    ) {
        Task { @MainActor in
            sdk.resetUser(reason: reason ?? "manual_reset")
            resolve(true)
        }
    }

    @objc(setUserProfile:userType:userProperties:appProperties:deviceProperties:customProperties:resolver:rejecter:)
    func setUserProfile(
        _ userId: String,
        userType: String,
        userProperties: NSDictionary?,
        appProperties: NSDictionary?,
        deviceProperties: NSDictionary?,
        customProperties: NSDictionary?,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: RCTPromiseRejectBlock
    ) {
        Task { @MainActor in
            sdk.setUserProfile(
                userId: userId,
                userType: userType,
                userProperties: dictionary(from: userProperties),
                appProperties: dictionary(from: appProperties),
                deviceProperties: dictionary(from: deviceProperties),
                customProperties: dictionary(from: customProperties)
            )
            resolve(true)
        }
    }

    @objc(setUserProperty:value:resolver:rejecter:)
    func setUserProperty(
        _ key: String,
        value: Any?,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: RCTPromiseRejectBlock
    ) {
        setProperty(resolve: resolve) { self.sdk.setUserProperty(key, value: self.bridgeValue(value) as Any) }
    }

    @objc(setAppProperty:value:resolver:rejecter:)
    func setAppProperty(
        _ key: String,
        value: Any?,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: RCTPromiseRejectBlock
    ) {
        setProperty(resolve: resolve) { self.sdk.setAppProperty(key, value: self.bridgeValue(value) as Any) }
    }

    @objc(setDeviceProperty:value:resolver:rejecter:)
    func setDeviceProperty(
        _ key: String,
        value: Any?,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: RCTPromiseRejectBlock
    ) {
        setProperty(resolve: resolve) { self.sdk.setDeviceProperty(key, value: self.bridgeValue(value) as Any) }
    }

    @objc(setCustomProperty:value:resolver:rejecter:)
    func setCustomProperty(
        _ key: String,
        value: Any?,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: RCTPromiseRejectBlock
    ) {
        setProperty(resolve: resolve) { self.sdk.setCustomProperty(key, value: self.bridgeValue(value) as Any) }
    }

    @objc(setUserType:resolver:rejecter:)
    func setUserType(
        _ userType: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: RCTPromiseRejectBlock
    ) {
        setProperty(resolve: resolve) { self.sdk.setUserType(userType) }
    }

    @objc(refreshFeatureFlags:resolver:rejecter:)
    func refreshFeatureFlags(
        _ force: Bool,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        Task { @MainActor in
            await sdk.refreshFeatureFlags(force: force)
            resolve(true)
        }
    }

    @objc(getFeatureFlag:defaultValue:resolver:rejecter:)
    func getFeatureFlag(
        _ flagKey: String,
        defaultValue: Any?,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        Task { @MainActor in
            guard let value = await sdk.getFeatureFlagValue(flagKey) else {
                resolve(bridgeValue(defaultValue))
                return
            }
            resolve(anyValue(from: value) ?? bridgeValue(defaultValue))
        }
    }

    @objc(getExperimentVariation:resolver:rejecter:)
    func getExperimentVariation(
        _ flagKey: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        Task { @MainActor in
            resolve(anyEncodable(await sdk.getExperimentVariation(flagKey)))
        }
    }

    @objc(getExperimentConfig:resolver:rejecter:)
    func getExperimentConfig(
        _ flagKey: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        Task { @MainActor in
            resolve(anyEncodable(await sdk.getExperimentConfig(flagKey)))
        }
    }

    @objc(trackExperimentExposure:context:resolver:rejecter:)
    func trackExperimentExposure(
        _ flagKey: String,
        context: NSDictionary?,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        Task { @MainActor in
            await sdk.trackExperimentExposure(flagKey, context: dictionary(from: context))
            resolve(true)
        }
    }

    @objc(trackExperimentConversion:goalId:value:context:resolver:rejecter:)
    func trackExperimentConversion(
        _ flagKey: String,
        goalId: String?,
        value: Any?,
        context: NSDictionary?,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        Task { @MainActor in
            await sdk.trackExperimentConversion(
                flagKey,
                goalId: normalized(goalId),
                value: bridgeValue(value),
                context: dictionary(from: context)
            )
            resolve(true)
        }
    }

    @objc(trackEvent:properties:eventType:resolver:rejecter:)
    func trackEvent(
        _ eventName: String,
        properties: NSDictionary?,
        eventType: String?,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: RCTPromiseRejectBlock
    ) {
        Task { @MainActor in
            sdk.trackEvent(eventName, properties: dictionary(from: properties), eventType: normalized(eventType) ?? "custom")
            resolve(true)
        }
    }

    @objc(refreshSurveys:resolver:rejecter:)
    func refreshSurveys(
        _ force: Bool,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        Task { @MainActor in
            await sdk.refreshSurveys(force: force)
            resolve(true)
        }
    }

    @objc(canShowSurvey:resolver:rejecter:)
    func canShowSurvey(
        _ eventName: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        Task { @MainActor in
            resolve(await sdk.canShowSurvey(eventName))
        }
    }

    @objc(showSurvey:resolver:rejecter:)
    func showSurvey(
        _ eventName: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        Task { @MainActor in
            let shown = await sdk.showSurvey(eventName, callback: SurveyBridgeCallback(module: self))
            if shown && !presentOverlay(mode: .survey, reject: reject) {
                return
            }
            resolve(shown)
        }
    }

    @objc(refreshAnnouncements:resolver:rejecter:)
    func refreshAnnouncements(
        _ force: Bool,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        Task { @MainActor in
            await sdk.refreshAnnouncements(force: force)
            resolve(true)
        }
    }

    @objc(canShowAnnouncement:resolver:rejecter:)
    func canShowAnnouncement(
        _ eventName: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        Task { @MainActor in
            resolve(await sdk.canShowAnnouncement(eventName))
        }
    }

    @objc(showAnnouncement:resolver:rejecter:)
    func showAnnouncement(
        _ eventName: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        Task { @MainActor in
            let shown = await sdk.showAnnouncement(eventName, callback: AnnouncementBridgeCallback(module: self))
            if shown && !presentOverlay(mode: .announcement, reject: reject) {
                return
            }
            resolve(shown)
        }
    }

    @objc(refreshLiveCards:resolver:rejecter:)
    func refreshLiveCards(
        _ force: Bool,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        Task { @MainActor in
            await sdk.refreshLiveCards(force: force)
            resolve(true)
        }
    }

    @objc(hasLiveCard:resolver:rejecter:)
    func hasLiveCard(
        _ triggerId: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        Task { @MainActor in
            resolve(await sdk.hasLiveCard(triggerId: triggerId))
        }
    }

    @objc(refreshMessageCenter:rejecter:)
    func refreshMessageCenter(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        Task { @MainActor in
            await sdk.refreshMessageCenter()
            resolve(true)
        }
    }

    @objc(openMessageCenter:announcementId:threadId:resolver:rejecter:)
    func openMessageCenter(
        _ initialTab: String?,
        announcementId: String?,
        threadId: String?,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        Task { @MainActor in
            await sdk.refreshMessageCenter()
            guard sdk.canShowMessageCenter() else {
                resolve(false)
                return
            }
            sdk.openMessageCenter(
                initialTab: normalized(initialTab),
                announcementId: normalized(announcementId),
                threadId: normalized(threadId)
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
                reject("APPRAINIER_NO_VIEW_CONTROLLER", "No view controller is available to present Message Center.", nil)
                return
            }
            presenter.present(viewController, animated: true) {
                resolve(true)
            }
        }
    }

    @objc(getUnreadMessageCount:rejecter:)
    func getUnreadMessageCount(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: RCTPromiseRejectBlock
    ) {
        Task { @MainActor in
            await sdk.refreshMessageCenter()
            resolve(sdk.getUnreadMessageCount())
        }
    }

    @objc(onPushTokenRefreshed:resolver:rejecter:)
    func onPushTokenRefreshed(
        _ token: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: RCTPromiseRejectBlock
    ) {
        Task { @MainActor in
            sdk.onPushTokenRefreshed(token)
            resolve(true)
        }
    }

    @objc(isAppRainierPush:resolver:rejecter:)
    func isAppRainierPush(
        _ userInfo: NSDictionary,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: RCTPromiseRejectBlock
    ) {
        Task { @MainActor in
            resolve(sdk.isAppRainierPush(userInfo: notificationUserInfo(from: userInfo)))
        }
    }

    @objc(handlePushMessage:resolver:rejecter:)
    func handlePushMessage(
        _ userInfo: NSDictionary,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: RCTPromiseRejectBlock
    ) {
        Task { @MainActor in
            resolve(sdk.handlePushMessage(userInfo: notificationUserInfo(from: userInfo)))
        }
    }

    @objc(getUserId:rejecter:)
    func getUserId(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: RCTPromiseRejectBlock
    ) {
        Task { @MainActor in
            resolve(sdk.getUserId())
        }
    }

    @objc(getUserDebugState:rejecter:)
    func getUserDebugState(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: RCTPromiseRejectBlock
    ) {
        Task { @MainActor in
            resolve(anyEncodable(sdk.getUserDebugState()))
        }
    }

    @objc(flush:rejecter:)
    func flush(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: RCTPromiseRejectBlock
    ) {
        Task { @MainActor in
            sdk.flush()
            resolve(true)
        }
    }

    @objc(shutdown:rejecter:)
    func shutdown(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: RCTPromiseRejectBlock
    ) {
        Task { @MainActor in
            sdk.shutdown()
            resolve(true)
        }
    }

    fileprivate func emit(name: String, body: [String: Any?]) {
        sendEvent(withName: name, body: body.compactMapValues { bridgeValue($0) })
    }

    private func setProperty(resolve: @escaping RCTPromiseResolveBlock, block: @escaping @MainActor () -> Void) {
        Task { @MainActor in
            block()
            resolve(true)
        }
    }

    private func dictionary(from source: NSDictionary?) -> [String: Any] {
        guard let source else { return [:] }
        var result: [String: Any] = [:]
        source.forEach { key, value in
            guard let key = key as? String else { return }
            if let bridged = bridgeValue(value) {
                result[key] = bridged
            }
        }
        return result
    }

    private func bridgeValue(_ value: Any?) -> Any? {
        switch value {
        case nil:
            return nil
        case is NSNull:
            return nil
        case let sourceDictionary as NSDictionary:
            return dictionary(from: sourceDictionary)
        case let array as NSArray:
            return array.compactMap { bridgeValue($0) }
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

    private func notificationUserInfo(from source: NSDictionary) -> [AnyHashable: Any] {
        var result: [AnyHashable: Any] = [:]
        source.forEach { key, value in
            guard let key = key as? String, let bridged = bridgeValue(value) else { return }
            result[AnyHashable(key)] = bridged
        }
        return result
    }

    private func normalized(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed?.isEmpty == false ? trimmed : nil
    }

    @MainActor
    private func presentOverlay(mode: AppRainierOverlayMode, reject: @escaping RCTPromiseRejectBlock) -> Bool {
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
            reject("APPRAINIER_NO_VIEW_CONTROLLER", "No view controller is available to present AppRainier content.", nil)
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
    weak var module: AppRainierReactNativePlugin?

    init(module: AppRainierReactNativePlugin) {
        self.module = module
    }

    func onSurveySubmitted(_ result: SurveyPresentationResult) {
        DispatchQueue.main.async { [weak self] in
            self?.module?.emit(name: "AppRainierSurveySubmitted", body: [
                "surveyId": result.surveyId,
                "responses": self?.responses(result.responses),
                "targetScreen": result.targetScreen,
                "deepLink": result.deepLink,
            ])
        }
    }

    func onSurveyCancelled(surveyId: String, targetScreen: String?, deepLink: String?) {
        DispatchQueue.main.async { [weak self] in
            self?.module?.emit(name: "AppRainierSurveyCancelled", body: [
                "surveyId": surveyId,
                "targetScreen": targetScreen,
                "deepLink": deepLink,
            ])
        }
    }

    func onSurveyDismissed(surveyId: String) {
        DispatchQueue.main.async { [weak self] in
            self?.module?.emit(name: "AppRainierSurveyDismissed", body: [
                "surveyId": surveyId,
            ])
        }
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
    weak var module: AppRainierReactNativePlugin?

    init(module: AppRainierReactNativePlugin) {
        self.module = module
    }

    func onAnnouncementSubmitted(_ result: AnnouncementPresentationResult) {
        DispatchQueue.main.async { [weak self] in
            self?.module?.emit(name: "AppRainierAnnouncementSubmitted", body: [
                "announcementId": result.announcementId,
                "responses": self?.responses(result.responses),
                "targetScreen": result.targetScreen,
                "deepLink": result.deepLink,
            ])
        }
    }

    func onAnnouncementCancelled(announcementId: String, targetScreen: String?, deepLink: String?) {
        DispatchQueue.main.async { [weak self] in
            self?.module?.emit(name: "AppRainierAnnouncementCancelled", body: [
                "announcementId": announcementId,
                "targetScreen": targetScreen,
                "deepLink": deepLink,
            ])
        }
    }

    func onAnnouncementDismissed(announcementId: String) {
        DispatchQueue.main.async { [weak self] in
            self?.module?.emit(name: "AppRainierAnnouncementDismissed", body: [
                "announcementId": announcementId,
            ])
        }
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
