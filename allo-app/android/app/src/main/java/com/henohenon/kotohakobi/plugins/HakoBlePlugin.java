package com.henohenon.kotohakobi.plugins;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.ParcelUuid;
import android.util.Log;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.List;
import java.util.Locale;

/**
 * Electron の window.ble 互換（受信専用）。
 * LocalName "HAKO" の広告から Service UUID 一覧を JS へ notifyListeners("packet") する。
 */
@CapacitorPlugin(
    name = "HakoBle",
    permissions = {
        @Permission(
            alias = "bluetooth",
            strings = {
                Manifest.permission.BLUETOOTH_SCAN,
                Manifest.permission.BLUETOOTH_CONNECT
            }
        ),
        @Permission(
            alias = "location",
            strings = { Manifest.permission.ACCESS_FINE_LOCATION }
        )
    }
)
public class HakoBlePlugin extends Plugin {
    private static final String TAG = "HakoBle";
    private static final String LOCAL_NAME = "HAKO";

    private String status = "IDLE";
    private boolean scanning = false;
    private BluetoothLeScanner scanner;
    private ScanCallback scanCallback;
    private PluginCall pendingScanCall;

    @PluginMethod
    public void setStatus(PluginCall call) {
        String next = call.getString("status");
        if (next == null) {
            resolveResult(call, false, "status is required");
            return;
        }

        switch (next) {
            case "IDLE":
                stopScanInternal();
                status = "IDLE";
                resolveResult(call, true, null);
                break;
            case "SCANNING":
                ensurePermissionsThenScan(call);
                break;
            case "ADVERTISE":
                stopScanInternal();
                status = "IDLE";
                resolveResult(call, false, "advertise は Android では未対応です");
                break;
            default:
                resolveResult(call, false, "unknown status: " + next);
                break;
        }
    }

    @PluginMethod
    public void advertise(PluginCall call) {
        resolveResult(call, false, "advertise は Android では未対応です");
    }

    private void ensurePermissionsThenScan(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (getPermissionState("bluetooth") != PermissionState.GRANTED) {
                pendingScanCall = call;
                requestPermissionForAlias("bluetooth", call, "permissionCallback");
                return;
            }
        } else {
            if (getPermissionState("location") != PermissionState.GRANTED) {
                pendingScanCall = call;
                requestPermissionForAlias("location", call, "permissionCallback");
                return;
            }
        }
        startScanInternal(call);
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        PluginCall target = pendingScanCall != null ? pendingScanCall : call;
        pendingScanCall = null;
        boolean ok =
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                ? getPermissionState("bluetooth") == PermissionState.GRANTED
                : getPermissionState("location") == PermissionState.GRANTED;
        if (ok) {
            startScanInternal(target);
        } else {
            resolveResult(target, false, "Bluetooth スキャン権限が拒否されました");
        }
    }

    private void startScanInternal(PluginCall call) {
        try {
            if (!getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)) {
                resolveResult(call, false, "この端末は BLE に対応していません");
                return;
            }

            BluetoothManager manager =
                (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
            if (manager == null) {
                resolveResult(call, false, "BluetoothManager を取得できません");
                return;
            }
            BluetoothAdapter adapter = manager.getAdapter();
            if (adapter == null || !adapter.isEnabled()) {
                resolveResult(call, false, "Bluetooth がオフです");
                return;
            }

            scanner = adapter.getBluetoothLeScanner();
            if (scanner == null) {
                resolveResult(call, false, "BluetoothLeScanner を取得できません");
                return;
            }

            // 既に SCANNING ならリスナーだけ付け直さず成功扱い。
            if (scanning) {
                status = "SCANNING";
                resolveResult(call, true, null);
                return;
            }

            stopScanInternal();

            // OEM 差で DeviceName フィルタが欠落することがあるため、OS 側は無フィルタ。
            // LocalName "HAKO" 判定は emitPacket 側（Electron/noble と同様）。
            ScanSettings settings =
                new ScanSettings.Builder()
                    .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
                    .setReportDelay(0)
                    .build();

            scanCallback =
                new ScanCallback() {
                    @Override
                    public void onScanResult(int callbackType, ScanResult result) {
                        emitPacket(result);
                    }

                    @Override
                    public void onBatchScanResults(List<ScanResult> results) {
                        for (ScanResult result : results) {
                            emitPacket(result);
                        }
                    }

                    @Override
                    public void onScanFailed(int errorCode) {
                        Log.w(TAG, "onScanFailed: " + errorCode);
                        scanning = false;
                        status = "IDLE";
                    }
                };

            scanner.startScan(null, settings, scanCallback);
            scanning = true;
            status = "SCANNING";
            Log.i(TAG, "scan started (localName filter=" + LOCAL_NAME + " in JS callback path)");
            resolveResult(call, true, null);
        } catch (SecurityException e) {
            Log.e(TAG, "startScan SecurityException", e);
            resolveResult(call, false, "スキャン権限エラー: " + e.getMessage());
        } catch (Exception e) {
            Log.e(TAG, "startScan failed", e);
            resolveResult(call, false, e.getMessage());
        }
    }

    private void emitPacket(ScanResult result) {
        if (result == null || result.getScanRecord() == null) return;

        String name = result.getScanRecord().getDeviceName();
        if (name == null) {
            name = result.getDevice() != null ? result.getDevice().getName() : null;
        }
        if (name == null || !LOCAL_NAME.equals(name)) return;

        List<ParcelUuid> serviceUuids = result.getScanRecord().getServiceUuids();
        if (serviceUuids == null || serviceUuids.isEmpty()) return;

        JSArray uuids = new JSArray();
        for (ParcelUuid parcelUuid : serviceUuids) {
            if (parcelUuid == null || parcelUuid.getUuid() == null) continue;
            // Electron/noble 同様にハイフン無し 32 桁 hex（小文字）へ正規化。
            String hex = parcelUuid.getUuid().toString().replace("-", "").toLowerCase(Locale.ROOT);
            uuids.put(hex);
        }
        if (uuids.length() == 0) return;

        JSObject payload = new JSObject();
        payload.put("serviceUuids", uuids);
        notifyListeners("packet", payload);
    }

    private void stopScanInternal() {
        if (scanner != null && scanCallback != null && scanning) {
            try {
                scanner.stopScan(scanCallback);
            } catch (SecurityException e) {
                Log.w(TAG, "stopScan SecurityException", e);
            } catch (Exception e) {
                Log.w(TAG, "stopScan failed", e);
            }
        }
        scanning = false;
        scanCallback = null;
    }

    private void resolveResult(PluginCall call, boolean ok, String error) {
        JSObject ret = new JSObject();
        ret.put("ok", ok);
        if (error != null) ret.put("error", error);
        call.resolve(ret);
    }

    @Override
    protected void handleOnDestroy() {
        stopScanInternal();
        super.handleOnDestroy();
    }
}
