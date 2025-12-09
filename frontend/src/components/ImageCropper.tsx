// src/components/ImageCropper.tsx
import React, { useState, useCallback } from 'react'
import Cropper from 'react-easy-crop'
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import getCroppedImg, { PixelCrop } from '@/lib/cropImage'
import { Slider } from "@/components/ui/slider"

interface ImageCropperProps {
  imageSrc: string | null
  isOpen: boolean
  onClose: () => void
  onCropComplete: (croppedBlob: Blob) => void
}

const ImageCropper: React.FC<ImageCropperProps> = ({ imageSrc, isOpen, onClose, onCropComplete }) => {
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<PixelCrop | null>(null)

  const onCropChange = (crop: { x: number; y: number }) => {
    setCrop(crop)
  }

  const onZoomChange = (zoom: number) => {
    setZoom(zoom)
  }

  const onCropCompleteHandler = useCallback((croppedArea: any, croppedAreaPixels: PixelCrop) => {
    setCroppedAreaPixels(croppedAreaPixels)
  }, [])

  const handleSave = async () => {
    if (imageSrc && croppedAreaPixels) {
      try {
        const croppedImage = await getCroppedImg(imageSrc, croppedAreaPixels)
        if (croppedImage) {
          onCropComplete(croppedImage)
        }
        onClose()
      } catch (e) {
        console.error(e)
      }
    }
  }

  if (!imageSrc) return null

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px] h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Crop Foto (9:16)</DialogTitle>
        </DialogHeader>
        
        <div className="relative flex-1 bg-black w-full min-h-[300px]">
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={9 / 16}
            onCropChange={onCropChange}
            onCropComplete={onCropCompleteHandler}
            onZoomChange={onZoomChange}
          />
        </div>

        <div className="py-4 space-y-2">
            <span className="text-sm font-medium">Zoom</span>
            <Slider 
                defaultValue={[1]} 
                min={1} 
                max={3} 
                step={0.1} 
                value={[zoom]}
                onValueChange={(vals) => setZoom(vals[0])}
            />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={handleSave}>Gunakan Foto Ini</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default ImageCropper