import { useRef, useState, useEffect } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import { Check, X, RotateCcw } from 'lucide-react';

interface SignatureCaptureProps {
  onSave: (signature: string) => void;
  onCancel: () => void;
  orderId: string;
  customerName: string;
}

export default function SignatureCapture({ onSave, onCancel, orderId, customerName }: SignatureCaptureProps) {
  const sigCanvas = useRef<SignatureCanvas>(null);
  const [isEmpty, setIsEmpty] = useState(true);

  useEffect(() => {
    // Component mounted - canvas is ready for interaction
  }, []);

  const handleSave = () => {
    if (sigCanvas.current && !sigCanvas.current.isEmpty()) {
      const signature = sigCanvas.current.getTrimmedCanvas().toDataURL('image/png');
      onSave(signature);
    }
  };

  const handleClear = () => {
    if (sigCanvas.current) {
      sigCanvas.current.clear();
      setIsEmpty(true);
    }
  };

  const handleEndStroke = () => {
    if (sigCanvas.current) {
      setIsEmpty(sigCanvas.current.isEmpty());
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                Capturar Assinatura
              </h3>
              <p className="text-sm text-gray-600 mt-1">
                Pedido: {orderId} - Cliente: {customerName}
              </p>
            </div>
            <button
              onClick={onCancel}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="h-6 w-6" />
            </button>
          </div>
        </div>

        <div className="p-6">
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Assinatura do Cliente
            </label>
            <div className="border-2 border-gray-300 rounded-lg overflow-hidden">
              <SignatureCanvas
                ref={sigCanvas}
                canvasProps={{
                  className: 'w-full h-48 bg-white cursor-crosshair',
                  style: { touchAction: 'none' },
                }}
                onEnd={handleEndStroke}
                penColor="black"
                backgroundColor="white"
                clearOnResize={false}
              />
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Use o mouse ou toque na tela para assinar
            </p>
          </div>

          <div className="flex justify-between items-center">
            <button
              onClick={handleClear}
              className="flex items-center px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Limpar
            </button>

            <div className="flex space-x-3">
              <button
                onClick={onCancel}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Cancelar
              </button>
              
              <button
                onClick={handleSave}
                disabled={isEmpty}
                className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Check className="h-4 w-4 mr-2" />
                Salvar Assinatura
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}