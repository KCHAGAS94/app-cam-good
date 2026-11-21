package com.camgood.camera

import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

/** <CameraView did="PIXB-..." resizeMode="contain" /> */
class CameraViewManager : SimpleViewManager<CameraView>() {
  override fun getName() = "CameraView"

  override fun createViewInstance(reactContext: ThemedReactContext) = CameraView(reactContext)

  @ReactProp(name = "did")
  fun setDid(view: CameraView, did: String?) = view.setDid(did)

  /** 0 / 90 / 180 / 270 — rotates the drawn picture (not the view itself). */
  @ReactProp(name = "imageRotation", defaultInt = 0)
  fun setImageRotation(view: CameraView, degrees: Int) {
    view.imageRotation = ((degrees % 360) + 360) % 360
  }

  @ReactProp(name = "resizeMode")
  fun setResizeMode(view: CameraView, mode: String?) {
    view.resizeMode = mode ?: "contain"
  }
}
