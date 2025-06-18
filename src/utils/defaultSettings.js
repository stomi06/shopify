/**
 * Default settings for the free shipping bar
 */

// Domyślne ustawienia dla Theme Extension (format snake_case)
function getDefaultSettings() {
  return {
    active: true,
    threshold: 200,
    calculate_difference: false,
    show_success_message: true,
    message_template: "Darmowa dostawa od {threshold} zł",
    loading_message: "Sprawdzam koszyk...",
    success_message: "Gratulacje! Masz darmową dostawę :)",
    bar_color: "#4CAF50",
    text_color: "#FFFFFF",
    font_size: 16,
    bar_position: "top",
    bar_height: 50,
    transparent_background: false
  };
}

// Domyślne ustawienia dla JavaScript (format camelCase)
function getDefaultSettingsForJS() {
  return {
    enabled: true,
    freeShippingThreshold: 200,
    barColor: '#4CAF50',
    textColor: '#FFFFFF',
    messageTemplate: 'Darmowa dostawa od 200 zł',
    loadingMessage: 'Aktualizuję dane z koszyka',
    successMessage: 'Gratulacje! Masz darmową dostawę :)',
    alwaysShowBar: true,
    barPosition: 'fixed',
    barTopOffset: 70,
    barHeight: 50,
    fontSize: 16,
    calculateDifference: false,
    boldText: false,
    showSuccessMessage: true,
    showBorder: false,
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 0,
    showShadow: false,
    shadowColor: 'rgba(0, 0, 0, 0.3)',
    shadowBlur: 5,
    shadowOffsetY: 2,
    transparentBackground: false,
    barWidth: 100
  };
}

// Konwersja między formatami
function convertSettingsToJS(themeSettings) {
  return {
    enabled: themeSettings.active,
    freeShippingThreshold: themeSettings.threshold,
    calculateDifference: themeSettings.calculate_difference,
    showSuccessMessage: themeSettings.show_success_message,
    messageTemplate: themeSettings.message_template,
    loadingMessage: themeSettings.loading_message,
    successMessage: themeSettings.success_message,
    barColor: themeSettings.bar_color,
    textColor: themeSettings.text_color,
    fontSize: themeSettings.font_size,
    barPosition: themeSettings.bar_position || 'fixed',
    barHeight: themeSettings.bar_height,
    transparentBackground: themeSettings.transparent_background
  };
}

function convertSettingsToTheme(jsSettings) {
  return {
    active: jsSettings.enabled,
    threshold: jsSettings.freeShippingThreshold,
    calculate_difference: jsSettings.calculateDifference,
    show_success_message: jsSettings.showSuccessMessage,
    message_template: jsSettings.messageTemplate,
    loading_message: jsSettings.loadingMessage,
    success_message: jsSettings.successMessage,
    bar_color: jsSettings.barColor,
    text_color: jsSettings.textColor,
    font_size: jsSettings.fontSize,
    bar_position: jsSettings.barPosition,
    bar_height: jsSettings.barHeight,
    transparent_background: jsSettings.transparentBackground
  };
}

module.exports = {
  getDefaultSettings,
  getDefaultSettingsForJS,
  convertSettingsToJS,
  convertSettingsToTheme
};
