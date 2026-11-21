package com.camgood.camera;

import android.content.Context;
import android.content.ContextWrapper;
import android.util.Log;

/**
 * Receives callbacks from libobject_jni.so.
 *
 * The native code looks these methods up BY NAME AND SIGNATURE on the object passed to
 * NativeCaller.PPPPSetCallbackContext(), so every method below must exist exactly as declared,
 * even the ones we don't use (a missing one makes the native side crash).
 * They mirror the callbacks of the vendor app's main activity.
 */
public class CamCallbacks extends ContextWrapper {
    private static final String TAG = "CamCallbacks";

    public interface Listener {
        void onStatus(String did, int type, int param);

        void onSearchResult(String mac, String name, String did, String ip, int port);

        void onVideoFrame(String did, byte[] data, int kind, int len, int width, int height, int timestamp);

        void onMessage(String did, String json);

        void onSnapshot(String did, byte[] jpeg, int len);

        /** Frame of a memory-card recording being played back. */
        void onPlaybackFrame(String did, byte[] data, int kind, int len, int width, int height,
                             int timestamp, int frameNo, int totalFrames);
    }

    private static volatile Listener listener;

    public static void setListener(Listener l) {
        listener = l;
    }

    public CamCallbacks(Context base) {
        super(base);
    }

    // ---- connection status: type 0 = PPPP status (0 connecting, 2 online, 3 failed, 4 disconnected,
    //      5 invalid id, 6 offline, 7 timeout, 8 error, 110 logged in elsewhere) ----
    public void PPPPMsgNotify(String did, int type, int param) {
        Log.d(TAG, "PPPPMsgNotify did=" + did + " type=" + type + " param=" + param);
        Listener l = listener;
        if (l != null) l.onStatus(did, type, param);
    }

    public void MessageNotify(String did, int type, int param) {
        Log.d(TAG, "MessageNotify did=" + did + " type=" + type + " param=" + param);
    }

    public void MessageNotifyDNS(int i) {
    }

    // ---- LAN search result ----
    public void SearchResult(int i, String mac, String name, String did, String ip, int port) {
        Log.d(TAG, "SearchResult did=" + did + " ip=" + ip + " name=" + name);
        Listener l = listener;
        if (l != null && did != null && did.trim().length() > 0) {
            l.onSearchResult(mac, name, did.trim(), ip, port);
        }
    }

    // ---- live video: kind 1 = decoded YUV420 (I420) frame, otherwise JPEG ----
    private void VideoData(String did, byte[] data, int kind, int len, int width, int height, int ts, int extra) {
        Listener l = listener;
        if (l != null) l.onVideoFrame(did, data, kind, len, width, height, ts);
    }

    public void CallBack_H264Data(String did, byte[] data, int type, int len, int ts) {
    }

    public void CallBack_VideoTrans_H264H265(String did, byte[] data, int type, int h265, int frameNo) {
    }

    // ---- JSON replies to TransferMessage commands ----
    public void CallBackTransferMessage(String did, String msg, int len) {
        Log.d(TAG, "TransferMessage did=" + did + " msg=" + msg);
        Listener l = listener;
        if (l != null && msg != null) l.onMessage(did, msg);
    }

    public void CallBack_Snapshot(String did, byte[] jpeg, int len) {
        Listener l = listener;
        if (l != null) l.onSnapshot(did, jpeg, len);
    }

    private void PPPPSnapshotNotify(String did, byte[] jpeg, int len) {
        CallBack_Snapshot(did, jpeg, len);
    }

    // ---- audio: PCM 16-bit mono 8 kHz, live and memory-card playback ----
    public void AudioData(byte[] data, int len) {
        if (data != null) AudioOut.INSTANCE.write(data, len);
    }

    public void AudioPCMDataPlayBack(byte[] data, int len, int i2) {
        if (data != null) AudioOut.INSTANCE.write(data, len);
    }

    // ---- unused, but must exist ----
    public void AudioDataPlayBack(byte[] data, int len) {
    }

    public void CallBack_AlarmNotify(String did, int type) {
    }

    public void CallBack_AlarmNotify(String did, String type) {
    }

    public void CallBack_AlarmNotifyDoorBell(String a, String b, String c, String d) {
    }

    public void CallBack_Checkhandle(String a, String b, String c, String d, int i) {
    }

    public void CallBack_MJTCPTrans(String did, String msg) {
    }

    public void CallBack_PICTrans(String did, String fileName, byte[] data, int i, int i2, int i3) {
    }

    // ---- memory-card playback: i=kind (1 = YUV420), i2=len, i3=width, i4=height, i5=timestamp (s),
    //      i7=frame number, i8=total frames (same mapping as the vendor app) ----
    public void CallBack_PlaybackVideoData(String did, byte[] data, int i, int i2, int i3, int i4, int i5, int i6, int i7, int i8) {
        Listener l = listener;
        if (l != null) l.onPlaybackFrame(did, data, i, i2, i3, i4, i5, i7, i8);
    }

    private void CallBack_RecordFileSearchResult(String did, String name, int i, int i2, int i3, int i4, int i5, int i6) {
    }

    public void CallBack_TYPEMODE(String did, String msg) {
        Log.d(TAG, "TYPEMODE did=" + did + " msg=" + msg);
    }

    public void ConfigWifiResult(int result, String did, String ssid, String pwd) {
        Log.d(TAG, "ConfigWifiResult " + result + " did=" + did);
    }
}
