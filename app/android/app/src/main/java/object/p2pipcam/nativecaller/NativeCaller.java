package object.p2pipcam.nativecaller;

import android.content.Context;

/**
 * JNI bridge to the vendor P2P library (libobject_jni.so).
 *
 * The package, class name and method signatures MUST stay exactly like this:
 * the native library binds to Java_object_p2pipcam_nativecaller_NativeCaller_<method>.
 *
 * Main flow:
 *   PPPPInitial("test") -> Init() -> PPPPSetCallbackContext(callbacks)
 *   StartPPPP(did, "admin", pwd, "test", 0)  -> PPPPMsgNotify(did, 0, status)  (2 = online)
 *   StartPPPPLivestream(did, 1)              -> VideoData(did, yuv420, 1, len, w, h, ts, ?)
 *   TransferMessage(did, json, 0)            -> CallBackTransferMessage(did, json, len)
 */
public class NativeCaller {
    static {
        System.loadLibrary("c++_shared");
        System.loadLibrary("avcodec");
        System.loadLibrary("avfilter");
        System.loadLibrary("avformat");
        System.loadLibrary("avutil");
        System.loadLibrary("postproc");
        System.loadLibrary("swresample");
        System.loadLibrary("swscale");
        System.loadLibrary("object_jni");
    }

    public static native int CloseAvi(String str);

    public static native int DecodeH264Frame(byte[] bArr, int i, byte[] bArr2, int i2, int[] iArr);

    public static native void DecoderFree();

    public static native void DecoderInit(int i);

    public static native void Free();

    public static native String GetVer();

    public static native void Init();

    public static native int OpenAviFileName(String str, String str2, String str3, int i, int i2, int i3, int i4);

    public static native int PPPPCheckDevOnline(String did);

    public static native int PPPPCheckDid(String did);

    public static native int PPPPCheckFileBuffer(String did);

    public static native int PPPPCheckHanle(String did);

    public static native void PPPPInitial(String server);

    public static native int PPPPNetworkDetect();

    public static native int PPPPSendFileData(String str, byte[] bArr, int i, int i2, int i3, int i4);

    /** Object whose methods receive the native callbacks (see com.camgood.camera.CamCallbacks). */
    public static native int PPPPSetCallbackContext(Context context);

    public static native int PPPPStartAudio(String did);

    public static native int PPPPStartTalk(String did);

    public static native int PPPPStartTalk1(String did, int i);

    public static native int PPPPStopAudio(String did);

    public static native int PPPPStopTalk(String did);

    public static native int PPPPTalkAudioData(String did, byte[] bArr, int i);

    public static native String SHIXGetAPPKey();

    public static native String SHIXGetAPPKey1(int i);

    public static native String SHIXGetAPPPay(int i);

    public static native String SHIXGetAPPSer();

    public static native String SHIXGetAPPSer1(int i);

    public static native String SHIXGetKey(String str);

    public static native String SHIXGetSer(String str);

    public static native int SetDevMac(String str, String str2);

    public static native void StartConfigWifi(String str, String str2, String str3, String str4);

    public static native int StartPPPP(String did, String user, String pwd, String server, int timeout);

    public static native int StartPPPP1(String str, String str2, String str3, String str4, int i, String str5);

    public static native int StartPPPPLivestream(String did, int streamId);

    public static native int StartPlayBack(String did, String fileName, int offset);

    /** LAN search; arg is the phone's local IP ("AA" when not on a 192.x network). */
    public static native void StartSearch(String localIp);

    public static native void StartSearch1(byte[] bArr, int i);

    public static native void StopConfigWifi();

    public static native int StopPPPP(String did);

    public static native int StopPPPPLivestream(String did);

    public static native int StopPlayBack(String did);

    public static native void StopSearch();

    /** Sends a JSON command ({"pro":...,"cmd":...,"user":...,"pwd":...}) to the camera. */
    public static native int TransferMessage(String did, String json, int flag);

    public static native int WriteAudioData(String str, byte[] bArr, int i);

    public static native int WriteData(String str, byte[] bArr, int i, int i2);

    public static native int YUV4202RGB565(byte[] yuv, byte[] rgb565, int width, int height);
}
