package com.apprainier.reactnative

import android.widget.FrameLayout
import com.apprainier.sdk.core.AppRainier
import com.apprainier.sdk.data.models.livecards.LiveCard
import com.apprainier.sdk.ui.livecards.LiveCardView
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import com.facebook.react.common.MapBuilder
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.uimanager.events.Event

class AppRainierLiveCardViewManager : SimpleViewManager<AppRainierLiveCardHostView>() {
    override fun getName(): String = REACT_CLASS

    override fun createViewInstance(reactContext: ThemedReactContext): AppRainierLiveCardHostView {
        return AppRainierLiveCardHostView(reactContext)
    }

    override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any> {
        return MapBuilder.of(
            "onCardClick",
            MapBuilder.of("registrationName", "onCardClick"),
            "onCardUnavailable",
            MapBuilder.of("registrationName", "onCardUnavailable"),
            "onCardReady",
            MapBuilder.of("registrationName", "onCardReady")
        )
    }

    @ReactProp(name = "triggerId")
    fun setTriggerId(view: AppRainierLiveCardHostView, triggerId: String?) {
        view.setTriggerId(triggerId)
    }

    @ReactProp(name = "refreshKey")
    fun setRefreshKey(view: AppRainierLiveCardHostView, refreshKey: Int) {
        view.reload()
    }

    companion object {
        private const val REACT_CLASS = "AppRainierLiveCardView"
    }
}

class AppRainierLiveCardHostView(
    private val reactContext: ThemedReactContext
) : FrameLayout(reactContext) {
    private var triggerId: String? = null
    private var loadToken = 0
    private var pendingReload = false

    fun setTriggerId(value: String?) {
        val cleaned = value?.trim()?.takeIf { it.isNotEmpty() }
        if (triggerId == cleaned) return
        triggerId = cleaned
        reload()
    }

    fun reload() {
        if (!isAttachedToWindow || width == 0) {
            pendingReload = true
            return
        }

        val currentTriggerId = triggerId
        removeAllViews()
        if (currentTriggerId == null) return

        pendingReload = false
        val token = ++loadToken
        runCatching {
            AppRainier.createLiveCardView(currentTriggerId, reactContext) { liveCardView ->
                UiThreadUtil.runOnUiThread {
                    if (token != loadToken || triggerId != currentTriggerId) return@runOnUiThread
                    removeAllViews()

                    if (liveCardView == null) {
                        emitUnavailable(currentTriggerId)
                        return@runOnUiThread
                    }

                    liveCardView.setOnLiveCardClickListener(object : LiveCardView.OnLiveCardClickListener {
                        override fun onLiveCardClicked(
                            card: LiveCard,
                            buttonType: String?,
                            carouselItemIndex: Int?
                        ) {
                            emitClick(card, buttonType, carouselItemIndex)
                        }

                        override fun onLiveCardDismissed(card: LiveCard) = Unit
                    })

                    addView(
                        liveCardView,
                        LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
                    )

                    post {
                        // AppRainier builds the Compose content before RN attaches the native view.
                        // Recreate it once attached so Compose receives the correct tree/measure pass.
                        liveCardView.getLiveCard()?.let { card ->
                            liveCardView.setLiveCard(card)
                        }
                        liveCardView.measure(
                            MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY),
                            MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY)
                        )
                        liveCardView.layout(0, 0, width, height)
                        liveCardView.requestLayout()
                        liveCardView.invalidate()
                        postDelayed({ emitReady(currentTriggerId) }, READY_EVENT_DELAY_MS)
                    }
                }
            }
        }.onFailure {
            emitUnavailable(currentTriggerId)
        }
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        post { flushPendingReload() }
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        if (w > 0) {
            post { flushPendingReload() }
        }
    }

    private fun flushPendingReload() {
        if (pendingReload && isAttachedToWindow && width > 0) {
            reload()
        }
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        super.onMeasure(widthMeasureSpec, heightMeasureSpec)
        val childWidth = measuredWidth
        val childHeight = measuredHeight
        for (index in 0 until childCount) {
            getChildAt(index).measure(
                MeasureSpec.makeMeasureSpec(childWidth, MeasureSpec.EXACTLY),
                MeasureSpec.makeMeasureSpec(childHeight, MeasureSpec.EXACTLY)
            )
        }
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        for (index in 0 until childCount) {
            getChildAt(index).layout(0, 0, right - left, bottom - top)
        }
    }

    private fun emitUnavailable(triggerId: String) {
        val event = Arguments.createMap().apply {
            putString("triggerId", triggerId)
        }
        dispatchEvent("onCardUnavailable", event)
    }

    private fun emitReady(triggerId: String) {
        val event = Arguments.createMap().apply {
            putString("triggerId", triggerId)
        }
        dispatchEvent("onCardReady", event)
    }

    private fun emitClick(
        card: LiveCard,
        buttonType: String?,
        carouselItemIndex: Int?
    ) {
        val actionTarget = if (carouselItemIndex != null) {
            card.structure?.carouselItems?.getOrNull(carouselItemIndex)?.deepLink
                ?: card.structure?.carouselItems?.getOrNull(carouselItemIndex)?.action?.target
                ?: card.deepLink
        } else {
            card.structure?.deepLink ?: card.deepLink
        }
        val event = Arguments.createMap().apply {
            putString("triggerId", triggerId)
            putString("liveCardId", card.id)
            putString("liveCardName", card.name)
            putString("buttonType", buttonType)
            putString("actionType", "deeplink")
            putString("actionTarget", actionTarget)
            carouselItemIndex?.let { putInt("carouselItemIndex", it) }
        }
        dispatchEvent("onCardClick", event)
    }

    private fun dispatchEvent(eventName: String, eventData: WritableMap) {
        UIManagerHelper.getEventDispatcher(reactContext)
            ?.dispatchEvent(
                AppRainierLiveCardEvent(
                    surfaceId = UIManagerHelper.getSurfaceId(this),
                    viewId = id,
                    liveCardEventName = eventName,
                    eventData = eventData
                )
            )
    }

    companion object {
        private const val READY_EVENT_DELAY_MS = 120L
    }
}

private class AppRainierLiveCardEvent(
    surfaceId: Int,
    viewId: Int,
    private val liveCardEventName: String,
    private val eventData: WritableMap
) : Event<AppRainierLiveCardEvent>(surfaceId, viewId) {
    override fun getEventName(): String = liveCardEventName

    override fun canCoalesce(): Boolean = false

    override fun getEventData(): WritableMap = eventData
}
